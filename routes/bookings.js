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

// PUT /api/bookings/:id/services – Zusatzleistungen setzen (José/Cecilia)
// Body: { breakfast: 'ja'|'nein'|null, interim_clean: 'ja'|'nein'|null }
// Gespeichert wird pro Apartment + Anreisedatum, damit die Angaben den
// stündlichen Excel-Import überleben.
router.put('/bookings/:id/services', requireAdmin, async (req, res, next) => {
  try {
    const norm = v => (v === 'ja' || v === 'nein') ? v : null;
    const breakfast     = norm((req.body || {}).breakfast);
    const interim_clean = norm((req.body || {}).interim_clean);

    const { rows } = await pool.query(
      `SELECT apartment_id, LEFT(start,10) as sd FROM bookings WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Buchung nicht gefunden' });
    const { apartment_id, sd } = rows[0];

    const { rows: saved } = await pool.query(
      `INSERT INTO booking_services (apartment_id, start, breakfast, interim_clean)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (apartment_id, start) DO UPDATE
         SET breakfast=EXCLUDED.breakfast, interim_clean=EXCLUDED.interim_clean
       RETURNING *`,
      [apartment_id, sd, breakfast, interim_clean]
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
