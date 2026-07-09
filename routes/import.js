const express = require('express');
const { pool } = require('../db');
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

// POST /api/import-bookings – Personenanzahl aus Excel
router.post('/import-bookings', async (req, res, next) => {
  try {
    const { rows: importRows } = req.body || {};
    if (!Array.isArray(importRows) || !importRows.length) {
      return res.status(400).json({ error: 'Keine Daten übergeben' });
    }

    const { rows: apartments } = await pool.query(
      `SELECT id, name, pms_code FROM apartments WHERE pms_code IS NOT NULL AND pms_code != ''`
    );
    const aptByCode = {};
    apartments.forEach(a => { aptByCode[a.pms_code.trim().toLowerCase()] = a; });

    let matched = 0, unmatched = 0, noBooking = 0;
    const details = [];

    for (const row of importRows) {
      const code    = String(row.zimmer || '').trim().toLowerCase();
      const persons = String(row.personen || '').trim();
      const start   = parseDate(row.anreise);

      if (!code || !start) { unmatched++; continue; }

      const apt = aptByCode[code];
      if (!apt) { unmatched++; details.push({ zimmer: row.zimmer, status: 'kein_apartment' }); continue; }

      const { rows: bookings } = await pool.query(
        `SELECT id FROM bookings WHERE apartment_id=$1 AND LEFT(start,10)=$2 LIMIT 1`,
        [apt.id, start]
      );

      if (!bookings.length) {
        noBooking++;
        details.push({ zimmer: row.zimmer, apt: apt.name, start, status: 'buchung_nicht_gefunden' });
        continue;
      }

      await pool.query(`UPDATE bookings SET persons=$1 WHERE id=$2`, [persons, bookings[0].id]);
      matched++;
      details.push({ zimmer: row.zimmer, apt: apt.name, start, persons, status: 'ok' });
    }

    res.json({ matched, unmatched, noBooking, details });
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
    const houseCache = {}; // name → id

    for (const row of importRows) {
      const houseName = String(row.haus || '').trim();
      const aptName   = String(row.apartment || '').trim();
      const icalUrl   = String(row.ical_url || '').trim() || null;
      const pmsCode   = String(row.pms_code || '').trim() || null;

      if (!houseName || !aptName) continue;

      // Haus anlegen oder wiederfinden
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

      // Apartment anlegen oder überspringen wenn schon vorhanden
      const { rows: existingApt } = await pool.query(
        `SELECT id FROM apartments WHERE LOWER(name)=$1 AND house_id=$2`,
        [aptName.toLowerCase(), houseId]
      );

      if (existingApt.length) {
        // Vorhandenes Apartment updaten (iCal + PMS Code)
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
