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

// Kernlogik: importiert ein Array von Buchungszeilen. Wird vom manuellen
// Upload UND vom automatischen Import (Make.com) genutzt.
async function importBookingRows(importRows) {
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

    return { created, updated, skipped, total: importRows.length, details };
}

// POST /api/import-bookings – manueller Upload aus dem Admin
router.post('/import-bookings', async (req, res, next) => {
  try {
    const { rows: importRows } = req.body || {};
    if (!Array.isArray(importRows) || !importRows.length) {
      return res.status(400).json({ error: 'Keine Daten übergeben' });
    }
    const result = await importBookingRows(importRows);
    res.json(result);
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

// ── Automatischer Import (Make.com) ──────────────────────
// POST /api/auto-import
// Empfängt eine Excel-Datei per multipart/form-data (Feld "file"),
// geschützt durch einen geheimen Token im Authorization-Header.
const multer = require('multer');
const XLSX   = require('xlsx');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Excel-Buffer → Buchungszeilen. Erkennt ZWEI Formate:
//  A) Altes Format: Header "zimmer" in Spalte B, An-/Abreise getrennt (E/F)
//  B) PMS-Format:   Header "Zi-Nr." in Spalte D, "Aufenthalt" kombiniert (G):
//                   "16.06. - 18.06.2026 (2)"  → Anreise 16.06.2026, Abreise 18.06.2026
function parseExcelBuffer(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

  // Format B erkennen: Header-Zeile mit "zi-nr." (Spalte D)
  let headerRowB = -1, colZi = -1, colName = -1, colPers = -1, colStay = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i] || [];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim().toLowerCase();
      if (val === 'zi-nr.' || val === 'zi-nr' || val === 'zimmer-nr.') {
        headerRowB = i; colZi = c;
        // Nachbarspalten für Name / Pers. / Aufenthalt suchen
        for (let cc = 0; cc < row.length; cc++) {
          const h = String(row[cc] || '').trim().toLowerCase();
          if (h === 'name')       colName = cc;
          if (h.startsWith('pers')) colPers = cc;
          if (h.startsWith('aufenthalt')) colStay = cc;
        }
        break;
      }
    }
    if (headerRowB !== -1) break;
  }

  if (headerRowB !== -1 && colStay !== -1) {
    // ── Format B (PMS) ──
    const rows = [];
    for (let i = headerRowB + 1; i < data.length; i++) {
      const row = data[i] || [];
      const code = String(row[colZi] || '').trim();
      const stay = String(row[colStay] || '').trim();
      if (!code || !stay) continue;

      // "16.06. - 18.06.2026 (2)" zerlegen
      const m = stay.match(/(\d{1,2})\.(\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (!m) continue;
      const [, d1, m1, d2, m2, yr] = m;
      let year1 = parseInt(yr), year2 = parseInt(yr);
      // Jahreswechsel: Anreise-Monat > Abreise-Monat → Anreise im Vorjahr
      if (parseInt(m1) > parseInt(m2)) year1 = year2 - 1;

      const start = `${year1}-${m1.padStart(2,'0')}-${d1.padStart(2,'0')}`;
      const end   = `${year2}-${m2.padStart(2,'0')}-${d2.padStart(2,'0')}`;

      rows.push({
        zimmer:   code,
        gast:     String(row[colName] || '').trim(),
        personen: String(row[colPers] || '').trim().replace(/\u00a0/g, ' '),
        anreise:  start,   // schon YYYY-MM-DD
        abreise:  end,
      });
    }
    return rows;
  }

  // ── Format A (altes Excel): Header "zimmer" in Spalte B ──
  let headerRow = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && String(row[1] || '').trim().toLowerCase() === 'zimmer') { headerRow = i; break; }
  }
  if (headerRow === -1) return [];

  const rows = [];
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[1]) continue;
    rows.push({
      zimmer:   String(row[1] || '').trim(),
      gast:     String(row[2] || '').trim(),
      personen: String(row[3] || '').trim(),
      anreise:  String(row[4] || '').trim(),
      abreise:  String(row[5] || '').trim(),
    });
  }
  return rows;
}

router.post('/auto-import', upload.single('file'), async (req, res, next) => {
  try {
    // Token-Prüfung
    const expected = process.env.AUTO_IMPORT_TOKEN;
    if (!expected) {
      return res.status(500).json({ error: 'AUTO_IMPORT_TOKEN ist nicht konfiguriert' });
    }
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (token !== expected) {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Keine Datei empfangen (Feld "file" fehlt)' });
    }

    const importRows = parseExcelBuffer(req.file.buffer);
    if (!importRows.length) {
      return res.status(400).json({ error: 'Keine gültigen Buchungszeilen in der Excel gefunden' });
    }

    const result = await importBookingRows(importRows);
    console.log(`Auto-Import: ${result.created} Buchungen importiert, ${result.skipped} übersprungen.`);
    res.json({ ok: true, ...result });
  } catch(e) {
    console.error('Auto-Import Fehler:', e.message);
    next(e);
  }
});

module.exports = router;
