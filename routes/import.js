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
    const aptById   = {};
    apartments.forEach(a => {
      aptByCode[a.pms_code.trim().toLowerCase()] = a;
      aptById[a.id] = a;
    });

    let created = 0, updated = 0, skipped = 0;
    const details = [];
    const unknownCodes = new Set(); // Zimmer-Codes ohne passendes Apartment
    let invalidCount = 0;           // unlesbare/unsinnige Zeilen

    // Zeilen validieren und nach Apartment gruppieren
    const rowsByApt = new Map(); // aptId → [{start,end,guestName,persons}]
    let minStart = null; // früheste Anreise in der Datei = Beginn des PMS-Export-Fensters
    for (const row of importRows) {
      const code      = String(row.zimmer    || '').trim().toLowerCase();
      const guestName = String(row.gast      || '').trim() || null;
      const persons   = String(row.personen  || '').trim() || null;
      const start     = parseDate(row.anreise);
      const end       = parseDate(row.abreise);

      if (!code || !start || !end) {
        skipped++; invalidCount++;
        details.push({ zimmer: row.zimmer || '?', anreise: row.anreise, abreise: row.abreise, status: 'datum_unlesbar' });
        continue;
      }
      if (end <= start) {
        skipped++; invalidCount++;
        details.push({ zimmer: row.zimmer, start, end, status: 'abreise_vor_anreise' });
        continue;
      }

      const apt = aptByCode[code];
      if (!apt) {
        skipped++;
        unknownCodes.add(String(row.zimmer).trim());
        details.push({ zimmer: row.zimmer, status: 'kein_apartment' });
        continue;
      }

      if (!rowsByApt.has(apt.id)) rowsByApt.set(apt.id, []);
      rowsByApt.get(apt.id).push({ start, end, guestName, persons });
      if (!minStart || start < minStart) minStart = start;
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

      // Die PMS-Liste deckt ein rollierendes Zeitfenster ab (ca. 1 Monat
      // zurück bis 1 Monat voraus). Innerhalb dieses Fensters ist die Liste
      // die volle Wahrheit → alle Nicht-manuellen Buchungen, die in das
      // Fenster fallen, werden ersetzt. Was VOR dem Fenster endet, bleibt
      // als Historie erhalten. Das Fenster bestimmen wir aus der Datei
      // selbst (früheste Anreise) – schickt das PMS eines Tages nur noch
      // Zukunftslisten, bleibt die Vergangenheit automatisch verschont.
      const deleteFrom = minStart || today;
      for (const [aptId, aptRows] of rowsByApt) {
        await client.query(
          `DELETE FROM bookings
           WHERE apartment_id=$1
           AND (source != 'manual' OR source IS NULL)
           AND LEFT("end",10) >= $2`,
          [aptId, deleteFrom]
        );

        for (const b of aptRows) {
          // Kennzeichen muss die Buchung EINDEUTIG beschreiben: Es kann zwei
          // Buchungen mit gleicher Anreise im selben Apartment geben
          // (z. B. Gruppen-/Splitbuchungen) – daher Anreise + Abreise + Gast.
          const guestSlug = (b.guestName || '')
            .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').substring(0, 24);
          const uid = `excel-${aptId}-${b.start}_${b.end}_${guestSlug}`;
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

    // Selbstkontrolle: stimmt die Datenbank jetzt exakt mit der Datei überein?
    const check = await verifyImport({
      rowsByApt, aptById, unknownCodes, invalidCount,
      minStart: minStart || today,
    });

    return { created, updated, skipped, total: importRows.length, details, check };
}

// ── Selbstkontrolle nach jedem Import ─────────────────────
// Vergleicht die importierte Datei Zeile für Zeile mit der Datenbank und
// speichert das Ergebnis. Admin & Planer zeigen bei Abweichungen eine
// Warnung an (GET /api/import-check).
async function verifyImport({ rowsByApt, aptById, unknownCodes, invalidCount, minStart }) {
  const missing = []; // in der Datei, fehlt in der DB
  const stale   = []; // in der DB, steht nicht (mehr) in der Datei

  for (const [aptId, aptRows] of rowsByApt) {
    const { rows: dbRows } = await pool.query(
      `SELECT LEFT(start,10) as s, LEFT("end",10) as e, guest_name
       FROM bookings
       WHERE apartment_id=$1
       AND (source != 'manual' OR source IS NULL)
       AND LEFT("end",10) >= $2`,
      [aptId, minStart]
    );
    const dbSet   = new Set(dbRows.map(r => `${r.s}|${r.e}`));
    const fileSet = new Set(aptRows.map(r => `${r.start}|${r.end}`));
    const aptName = aptById[aptId]?.name || `Apartment ${aptId}`;

    aptRows.forEach(r => {
      if (!dbSet.has(`${r.start}|${r.end}`))
        missing.push({ apt: aptName, start: r.start, end: r.end, gast: r.guestName });
    });
    dbRows.forEach(r => {
      if (!fileSet.has(`${r.s}|${r.e}`))
        stale.push({ apt: aptName, start: r.s, end: r.e, gast: r.guest_name });
    });
  }

  // Apartments mit PMS-Code, die Buchungen im Zeitfenster haben, aber in der
  // Datei überhaupt nicht vorkommen (z. B. alles storniert – oder Teilliste)
  const inFile = [...rowsByApt.keys()];
  const params = [minStart, ...inFile];
  const notIn  = inFile.length
    ? `AND a.id NOT IN (${inFile.map((_, i) => `$${i + 2}`).join(',')})` : '';
  const { rows: orphanApts } = await pool.query(
    `SELECT DISTINCT a.name FROM apartments a
     JOIN bookings b ON b.apartment_id = a.id
     WHERE a.pms_code IS NOT NULL AND a.pms_code != ''
     AND (b.source != 'manual' OR b.source IS NULL)
     AND LEFT(b."end",10) >= $1
     ${notIn}`,
    params
  );

  const check = {
    checked_at: new Date().toISOString(),
    ok: !missing.length && !stale.length && !unknownCodes.size &&
        !invalidCount && !orphanApts.length,
    missing_total: missing.length,
    stale_total:   stale.length,
    missing: missing.slice(0, 20),
    stale:   stale.slice(0, 20),
    unknown_codes: [...unknownCodes].slice(0, 20),
    invalid_rows:  invalidCount,
    apartments_not_in_file: orphanApts.map(a => a.name).slice(0, 20),
  };

  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ('import_check', $1)
     ON CONFLICT (key) DO UPDATE SET value=$1`,
    [JSON.stringify(check)]
  ).catch(e => console.error('import_check speichern fehlgeschlagen:', e.message));

  if (!check.ok) {
    console.warn('Import-Selbstkontrolle meldet Abweichungen:',
      JSON.stringify({ missing: check.missing_total, stale: check.stale_total,
        unknown: check.unknown_codes.length, invalid: check.invalid_rows,
        not_in_file: check.apartments_not_in_file.length }));
  }
  return check;
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

// GET /api/import-check – Ergebnis der letzten Import-Selbstkontrolle.
// Offen, weil auch die (offene) Planer-Ansicht die Warnung anzeigen soll.
router.get('/import-check', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_meta WHERE key='import_check'`);
    res.json(rows[0] ? JSON.parse(rows[0].value) : { ok: null });
  } catch(e) { next(e); }
});

// GET /api/last-import – Zeitpunkt des letzten automatischen Imports
router.get('/last-import', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_meta WHERE key='last_auto_import'`);
    res.json({ last_auto_import: rows[0]?.value || null });
  } catch(e) { next(e); }
});

module.exports = router;
