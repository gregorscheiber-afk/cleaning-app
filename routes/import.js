const express = require('express');
const { pool } = require('../db');
const { recomputeStatus } = require('../services/icalSync');
const { requireAdmin } = require('../services/auth');
const router = express.Router();

// Datum zu YYYY-MM-DD. Versteht:
//   TT.MM.JJJJ  (deutsches Format)
//   M/D/YY bzw. M/D/YYYY (SheetJS-Standardformat für Datumszellen – US-Reihenfolge!)
//   JJJJ-MM-TT  (ISO)
function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  return null;
}

// Heutiges Datum in Wiener Zeit (konsistent mit der Statusberechnung)
function viennaToday() {
  const v = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
  return v.getFullYear() + '-' +
    String(v.getMonth() + 1).padStart(2, '0') + '-' +
    String(v.getDate()).padStart(2, '0');
}

// Kernlogik: importiert ein Array von Buchungszeilen. Wird vom manuellen
// Upload UND vom automatischen Import (Make.com) genutzt.
//
// Wichtig für die Korrektheit:
// - Nur laufende/zukünftige Buchungen werden ersetzt. Bereits beendete
//   Buchungen bleiben erhalten – die Excel-Liste enthält die Vergangenheit
//   oft nicht mehr, und ohne den letzten Checkout würde die Statusberechnung
//   ein ungeputztes Apartment fälschlich als "sauber" einstufen (und im
//   Planer fehlten die letzten Abreisen).
// - Alles läuft in EINER Transaktion: bricht der Import ab, bleibt der
//   alte Zustand vollständig bestehen.
// - Zeilen mit Abreise <= Anreise werden abgewiesen statt importiert.
async function importBookingRows(importRows) {
    // Apartments per PMS-Code laden
    const { rows: apartments } = await pool.query(
      `SELECT id, name, pms_code FROM apartments WHERE pms_code IS NOT NULL AND pms_code != ''`
    );
    const aptByCode = {};
    apartments.forEach(a => { aptByCode[a.pms_code.trim().toLowerCase()] = a; });

    let created = 0, updated = 0, skipped = 0;
    const details = [];

    // Zeilen validieren und nach Apartment gruppieren
    const rowsByApt = new Map(); // aptId → [{start,end,guestName,persons}]
    for (const row of importRows) {
      const code      = String(row.zimmer    || '').trim().toLowerCase();
      const guestName = String(row.gast      || '').trim() || null;
      const persons   = String(row.personen  || '').trim() || null;
      const start     = parseDate(row.anreise);
      const end       = parseDate(row.abreise);

      if (!code || !start || !end) {
        skipped++;
        details.push({ zimmer: row.zimmer || '?', anreise: row.anreise, abreise: row.abreise, status: 'datum_unlesbar' });
        continue;
      }
      if (end <= start) {
        skipped++;
        details.push({ zimmer: row.zimmer, start, end, status: 'abreise_vor_anreise' });
        continue;
      }

      const apt = aptByCode[code];
      if (!apt) {
        skipped++;
        details.push({ zimmer: row.zimmer, status: 'kein_apartment' });
        continue;
      }

      if (!rowsByApt.has(apt.id)) rowsByApt.set(apt.id, []);
      rowsByApt.get(apt.id).push({ start, end, guestName, persons });
      details.push({ zimmer: row.zimmer, apt: apt.name, start, end, status: 'ok' });
    }

    const today = viennaToday();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Alle bestehenden Highlights löschen – frischer Start bei jedem Upload
      for (const apt of Object.values(aptByCode)) {
        await client.query(
          `UPDATE bookings SET highlighted_until=NULL WHERE apartment_id=$1`,
          [apt.id]
        );
      }

      // Vor dem Ersetzen: nächste bekannte Buchung pro Apartment merken
      const prevNext = {}; // aptId → frühestes zukünftiges Startdatum
      for (const aptId of rowsByApt.keys()) {
        const { rows } = await client.query(
          `SELECT LEFT(start,10) as d FROM bookings
           WHERE apartment_id=$1 AND LEFT(start,10)>$2
           ORDER BY start ASC LIMIT 1`,
          [aptId, today]
        );
        prevNext[aptId] = rows[0]?.d || null;
      }

      for (const [aptId, aptRows] of rowsByApt) {
        // Laufende + zukünftige Buchungen ersetzen (außer manuelle);
        // beendete Buchungen bleiben als Historie erhalten
        await client.query(
          `DELETE FROM bookings
           WHERE apartment_id=$1
           AND (source != 'manual' OR source IS NULL)
           AND LEFT("end",10) > $2`,
          [aptId, today]
        );

        for (const b of aptRows) {
          const uid = `excel-${aptId}-${b.start}`;
          await client.query(
            `INSERT INTO bookings (apartment_id, uid, start, "end", guest_name, persons, source)
             VALUES ($1, $2, $3, $4, $5, $6, 'excel')
             ON CONFLICT (apartment_id, uid) DO UPDATE SET
               "end"=EXCLUDED."end", guest_name=EXCLUDED.guest_name,
               persons=EXCLUDED.persons, source='excel', synced_at=NOW()`,
            [aptId, uid, b.start, b.end, b.guestName, b.persons]
          );
          created++;
        }

        // Neue frühere Buchung? → im Planer bis 19:00 Uhr hervorheben
        const { rows: newNext } = await client.query(
          `SELECT id, LEFT(start,10) as d FROM bookings
           WHERE apartment_id=$1 AND LEFT(start,10)>$2
           ORDER BY start ASC LIMIT 1`,
          [aptId, today]
        );
        const newNextDate = newNext[0]?.d || null;
        const oldNextDate = prevNext[aptId] || null;
        if (newNextDate && (!oldNextDate || newNextDate < oldNextDate)) {
          await client.query(
            `UPDATE bookings SET highlighted_until=$1 WHERE id=$2`,
            [`${newNextDate}T19:00:00`, newNext[0].id]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Status der betroffenen Apartments neu berechnen (nach dem COMMIT)
    for (const aptId of rowsByApt.keys()) {
      await recomputeStatus(aptId);
    }

    return { created, updated, skipped, total: importRows.length, details };
}

// POST /api/import-bookings – manueller Upload aus dem Admin
router.post('/import-bookings', requireAdmin, async (req, res, next) => {
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
router.post('/import-structure', requireAdmin, async (req, res, next) => {
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

      // "16.06. - 18.06.2026 (2)" zerlegen – Anreise darf auch ein eigenes
      // Jahr haben ("28.12.2026 - 03.01.2027")
      const m = stay.match(/(\d{1,2})\.(\d{1,2})\.(?:\s*(\d{4}))?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (!m) continue;
      const [, d1, m1, y1, d2, m2, yr] = m;
      const year2 = parseInt(yr);
      let year1 = y1 ? parseInt(y1) : year2;
      // Ohne explizites Anreise-Jahr: Anreise-Monat > Abreise-Monat → Vorjahr
      if (!y1 && parseInt(m1) > parseInt(m2)) year1 = year2 - 1;

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

    // SOFORT antworten, damit Make.com keinen Timeout bekommt.
    // Der eigentliche Import läuft danach im Hintergrund weiter.
    res.json({ ok: true, received: importRows.length, message: 'Import gestartet' });

    // Import im Hintergrund ausführen (nach der Antwort)
    importBookingRows(importRows)
      .then(async result => {
        console.log(`Auto-Import fertig: ${result.created} importiert, ${result.skipped} übersprungen.`);
        // Zeitpunkt des letzten automatischen Imports speichern
        await pool.query(
          `INSERT INTO app_meta (key, value) VALUES ('last_auto_import', $1)
           ON CONFLICT (key) DO UPDATE SET value=$1`,
          [new Date().toISOString()]
        ).catch(e => console.error('last_auto_import speichern fehlgeschlagen:', e.message));
      })
      .catch(err => {
        console.error('Auto-Import Hintergrund-Fehler:', err.message);
      });
  } catch(e) {
    console.error('Auto-Import Fehler:', e.message);
    if (!res.headersSent) next(e);
  }
});

// GET /api/last-import – Zeitpunkt des letzten automatischen Imports
router.get('/last-import', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_meta WHERE key='last_auto_import'`);
    res.json({ last_auto_import: rows[0]?.value || null });
  } catch(e) { next(e); }
});

module.exports = router;
