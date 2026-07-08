const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Datum von DD.MM.YYYY zu YYYY-MM-DD
function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  // DD.MM.YYYY
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  return null;
}

// POST /api/import-bookings
// Body: { rows: [{zimmer, personen, anreise, abreise}] }
router.post('/import-bookings', async (req, res, next) => {
  try {
    const { rows: importRows } = req.body || {};
    if (!Array.isArray(importRows) || !importRows.length) {
      return res.status(400).json({ error: 'Keine Daten übergeben' });
    }

    // Alle Apartments mit pms_code laden
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
      const end     = parseDate(row.abreise);

      if (!code || !start || !end) { unmatched++; continue; }

      const apt = aptByCode[code];
      if (!apt) {
        unmatched++;
        details.push({ zimmer: row.zimmer, status: 'kein_apartment' });
        continue;
      }

      // Buchung anhand Apartment + Startdatum finden (ersten 10 Zeichen vergleichen)
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

module.exports = router;
