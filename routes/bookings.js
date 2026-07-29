const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../services/auth');
const router = express.Router();

// PUT /api/bookings/:id/persons
router.put('/bookings/:id/persons', requireAdmin, async (req, res, next) => {
  try {
    const { adults = 0, children = 0, babies = 0 } = req.body || {};
    const parts = [];
    if (Number(adults)   > 0) parts.push(`${adults} Erw.`);
    if (Number(children) > 0) parts.push(`${children} Kind${Number(children)>1?'er':''}`);
    if (Number(babies)   > 0) parts.push(`${babies} Baby${Number(babies)>1?'s':''}`);
    const persons = parts.join(' · ') || null;
    await pool.query(`UPDATE bookings SET persons=$1 WHERE id=$2`, [persons, req.params.id]);
    res.json({ id: req.params.id, persons, adults: Number(adults), children: Number(children), babies: Number(babies) });
  } catch(e) { next(e); }
});

// POST /api/apartments/:id/bookings – manuelle Buchung anlegen
router.post('/apartments/:id/bookings', requireAdmin, async (req, res, next) => {
  try {
    const { start, end, persons } = req.body || {};
    if (!start || !end) return res.status(400).json({ error: 'start und end sind erforderlich' });
    if (start >= end) return res.status(400).json({ error: 'Abreise muss nach Anreise liegen' });

    const apt = await pool.query(`SELECT id FROM apartments WHERE id=$1`, [req.params.id]);
    if (!apt.rows.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });

    const uid = `manual-${req.params.id}-${start}`;
    const { rows } = await pool.query(
      `INSERT INTO bookings (apartment_id, uid, start, "end", persons, source)
       VALUES ($1, $2, $3, $4, $5, 'manual') RETURNING *`,
      [req.params.id, uid, start, end, persons || null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

// PUT /api/bookings/:id/services – Zusatzleistungen pro Buchung setzen.
// Body kann eine beliebige Teilmenge enthalten:
//   breakfast / interim_clean  (nur Cecilia) und baby_cot / high_chair (alle)
// jeweils 'ja' | 'nein' | null. Nur die ÜBERGEBENEN Felder werden geändert,
// die übrigen bleiben erhalten (damit ein Schalter die anderen nicht löscht).
// Gespeichert pro Apartment + Anreisedatum, überlebt so den Excel-Import.
router.put('/bookings/:id/services', requireAdmin, async (req, res, next) => {
  try {
    // Frühstück/Zwischenreinigung: 'ja'|'nein'|null
    const normYN = v => (v === 'ja' || v === 'nein') ? v : null;
    // Kinderbett/Hochstuhl: Anzahl 0..20 als Text. Alt-Werte 'ja'→1, 'nein'→0.
    const normCount = v => {
      if (v === 'ja')   return '1';
      if (v === 'nein') return '0';
      if (v === null || v === undefined || v === '') return null;
      const n = parseInt(v, 10);
      return (Number.isInteger(n) && n >= 0 && n <= 20) ? String(n) : null;
    };
    const NORM = { breakfast: normYN, interim_clean: normYN, baby_cot: normCount, high_chair: normCount };
    const body = req.body || {};
    const FIELDS = ['breakfast', 'interim_clean', 'baby_cot', 'high_chair'];

    const { rows } = await pool.query(
      `SELECT apartment_id, LEFT(start,10) as sd FROM bookings WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Buchung nicht gefunden' });
    const { apartment_id, sd } = rows[0];

    // Bestehende Werte laden und die übergebenen Felder darüberlegen
    const { rows: existing } = await pool.query(
      `SELECT * FROM booking_services WHERE apartment_id=$1 AND start=$2`,
      [apartment_id, sd]
    );
    const cur = existing[0] || {};
    const merged = {};
    for (const f of FIELDS) merged[f] = (f in body) ? NORM[f](body[f]) : (cur[f] ?? null);

    const { rows: saved } = await pool.query(
      `INSERT INTO booking_services (apartment_id, start, breakfast, interim_clean, baby_cot, high_chair)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (apartment_id, start) DO UPDATE
         SET breakfast=EXCLUDED.breakfast, interim_clean=EXCLUDED.interim_clean,
             baby_cot=EXCLUDED.baby_cot, high_chair=EXCLUDED.high_chair
       RETURNING *`,
      [apartment_id, sd, merged.breakfast, merged.interim_clean, merged.baby_cot, merged.high_chair]
    );
    res.json(saved[0]);
  } catch(e) { next(e); }
});

// DELETE /api/bookings/:id – nur manuelle Buchungen löschbar
router.delete('/bookings/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT source FROM bookings WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Buchung nicht gefunden' });
    if (rows[0].source !== 'manual') return res.status(403).json({ error: 'Nur manuelle Buchungen können gelöscht werden' });
    await pool.query(`DELETE FROM bookings WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch(e) { next(e); }
});

module.exports = router;
