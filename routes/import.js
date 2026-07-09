const express = require('express');
const { pool } = require('../db');
const { recomputeStatus } = require('../services/icalSync');
const router = express.Router();

// Datum von DD.MM.YYYY zu YYYY-MM-DD
function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  return null;
}

// POST /api/import-bookings
// Erstellt Buchungen aus Excel – Hauptquelle für Buchungsdaten
router.post('/import-bookings', async (req, res, next) => {
  try {
    const { rows: importRows } = req.body || {};
    if (!Array.isArray(importRows) || !importRows.length) {
      return res.status(400).json({ error: 'Keine Daten übergeben' });
    }

    // Apartments per PMS-Code laden
    const { rows: apartments } = await pool.query(
      `SELECT id, name, pms_code FROM apartments WHERE pms_code IS NOT NULL AND pms_code != ''`
    );
    const aptByCode = {};
    apartments.forEach(a => { aptByCode[a.pms_code.trim().toLowerCase()] = a; });

    let created = 0, updated = 0, skipped = 0;
    const affectedApts = new Set();
    const details = [];

    // Vor dem Import: nächste bekannte Buchung pro Apartment merken
    const nowIso = new Date().toISOString();
    const prevNext = {}; // aptId → frühestes zukünftiges Startdatum
    for (const apt of Object.values(aptByCode)) {
      const { rows } = await pool.query(
        `SELECT LEFT(start,10) as d FROM bookings
         WHERE apartment_id=$1 AND start>$2
         ORDER BY start ASC LIMIT 1`,
        [apt.id, nowIso]
      );
      prevNext[apt.id] = rows[0]?.d || null;
    }

    // Alle bestehenden Highlights löschen – frischer Start bei jedem Upload
    for (const apt of Object.values(aptByCode)) {
      await pool.query(
        `UPDATE bookings SET highlighted_until=NULL WHERE apartment_id=$1`,
        [apt.id]
      );
    }

    for (const row of importRows) {
      const code      = String(row.zimmer    || '').trim().toLowerCase();
      const guestName = String(row.gast      || '').trim() || null;
      const persons   = String(row.personen  || '').trim() || null;
      const start     = parseDate(row.anreise);
      const end       = parseDate(row.abreise);

      if (!code || !start || !end) { skipped++; continue; }

      const apt = aptByCode[code];
      if (!apt) {
        skipped++;
        details.push({ zimmer: row.zimmer, status: 'kein_apartment' });
        continue;
      }

      // Beim ersten Excel-Eintrag für dieses Apartment:
      // ALLE alten Buchungen löschen (außer manuelle) → sauberer Neustart
      if (!affectedApts.has(apt.id)) {
        await pool.query(
          `DELETE FROM bookings WHERE apartment_id=$1 AND (source != 'manual' OR source IS NULL)`,
          [apt.id]
        );
      }

      // Immer neu einfügen – keine Duplikat-Prüfung nötig da vorher gelöscht
      const uid = `excel-${apt.id}-${start}`;
      await pool.query(
        `INSERT INTO bookings (apartment_id, uid, start, "end", guest_name, persons, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'excel')
         ON CONFLICT (apartment_id, uid) DO UPDATE SET
           "end"=EXCLUDED."end", guest_name=EXCLUDED.guest_name,
           persons=EXCLUDED.persons, synced_at=NOW()`,
        [apt.id, uid, start, end, guestName, persons]
      );
      created++;

      affectedApts.add(apt.id);
      details.push({ zimmer: row.zimmer, apt: apt.name, start, end, status: 'ok' });
    }

    // Nach dem Import: neue frühere Buchungen highlighten
    for (const aptId of affectedApts) {
      const { rows: newNext } = await pool.query(
        `SELECT id, LEFT(start,10) as d FROM bookings
         WHERE apartment_id=$1 AND start>$2
         ORDER BY start ASC LIMIT 1`,
        [aptId, nowIso]
      );
      const newNextDate = newNext[0]?.d || null;
      const oldNextDate = prevNext[aptId] || null;

      // Nur highlighten wenn eine neue Buchung früher ist als die vorherige nächste
      if (newNextDate && (!oldNextDate || newNextDate < oldNextDate)) {
        const highlightedUntil = `${newNextDate}T19:00:00`;
        await pool.query(
          `UPDATE bookings SET highlighted_until=$1
           WHERE id=$2`,
          [highlightedUntil, newNext[0].id]
        );
      }

      await recomputeStatus(aptId);
    }

    res.json({ created, updated, skipped, total: importRows.length, details });
  } catch(e) { next(e); }
});

// POST /api/import-structure – Häuser & Apartments aus Excel anlegen
router.post('/import-structure', async (req, res, next) => {
  try {
    const { rows: importRows } = req.body || {};
    if (!Array.isArray(importRows) || !importRows.length) {
      return res.status(400).json({ error: 'Keine Daten übergeben' });
    }

    let housesCreated = 0, housesExisting = 0;
    let aptsCreated = 0, aptsExisting = 0;
    const houseCache = {};

    for (const row of importRows) {
      const houseName = String(row.haus      || '').trim();
      const aptName   = String(row.apartment || '').trim();
      const icalUrl   = String(row.ical_url  || '').trim() || null;
      const pmsCode   = String(row.pms_code  || '').trim() || null;

      if (!houseName || !aptName) continue;

      if (!houseCache[houseName.toLowerCase()]) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM houses WHERE LOWER(name)=$1`, [houseName.toLowerCase()]
        );
        if (existing.length) {
          houseCache[houseName.toLowerCase()] = existing[0].id;
          housesExisting++;
        } else {
          const { rows: created } = await pool.query(
            `INSERT INTO houses (name) VALUES ($1) RETURNING id`, [houseName]
          );
          houseCache[houseName.toLowerCase()] = created[0].id;
          housesCreated++;
        }
      }

      const houseId = houseCache[houseName.toLowerCase()];

      const { rows: existingApt } = await pool.query(
        `SELECT id FROM apartments WHERE LOWER(name)=$1 AND house_id=$2`,
        [aptName.toLowerCase(), houseId]
      );

      if (existingApt.length) {
        await pool.query(
          `UPDATE apartments SET ical_url=COALESCE($1,ical_url), pms_code=COALESCE($2,pms_code) WHERE id=$3`,
          [icalUrl, pmsCode, existingApt[0].id]
        );
        aptsExisting++;
      } else {
        await pool.query(
          `INSERT INTO apartments (name, house_id, ical_url, pms_code) VALUES ($1,$2,$3,$4)`,
          [aptName, houseId, icalUrl, pmsCode]
        );
        aptsCreated++;
      }
    }

    res.json({ housesCreated, housesExisting, aptsCreated, aptsExisting });
  } catch(e) { next(e); }
});

module.exports = router;
