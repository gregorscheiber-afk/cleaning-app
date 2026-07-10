const express = require('express');
const { pool } = require('../db');
const { recomputeStatus } = require('../services/icalSync');
const { notifyApartmentClean } = require('../services/notify');
const router = express.Router();

router.post('/apartments/:id/confirm-clean', async (req, res, next) => {
  try {
    const { cleaner_name, note } = req.body || {};
    if (!cleaner_name) return res.status(400).json({ error: 'cleaner_name ist erforderlich' });
    const { rows } = await pool.query(`SELECT a.*, h.name as house_name FROM apartments a LEFT JOIN houses h ON h.id=a.house_id WHERE a.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const apt = rows[0];
    await pool.query(
      `INSERT INTO cleanings (apartment_id,cleaner_name,note) VALUES ($1,$2,$3)`,
      [apt.id, cleaner_name, note || null]
    );
    await pool.query(`DELETE FROM apartment_notes WHERE apartment_id=$1`, [apt.id]);
    const newStatus = await recomputeStatus(apt.id);
    await notifyApartmentClean(apt, cleaner_name);
    const { rows: updated } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [apt.id]);
    res.json({ apartment: updated[0], status: newStatus });
  } catch(e) { next(e); }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const { since } = req.query;
    const { rows } = since
      ? await pool.query(`SELECT * FROM notifications WHERE created_at>$1 ORDER BY created_at DESC`, [since])
      : await pool.query(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`);
    res.json(rows);
  } catch(e) { next(e); }
});

router.get('/cleanings', async (req, res, next) => {
  try {
    const { apartment_id } = req.query;
    const { rows } = apartment_id
      ? await pool.query(`SELECT * FROM cleanings WHERE apartment_id=$1 ORDER BY confirmed_at DESC`, [apartment_id])
      : await pool.query(`SELECT * FROM cleanings ORDER BY confirmed_at DESC LIMIT 100`);
    res.json(rows);
  } catch(e) { next(e); }
});

// GET /api/cleanings/stats – Reinigungszeiten Statistik
router.get('/cleanings/stats', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.confirmed_at,
        a.name as apt_name,
        h.name as house_name,
        EXTRACT(HOUR FROM c.confirmed_at AT TIME ZONE 'Europe/Vienna') as hour
      FROM cleanings c
      JOIN apartments a ON a.id = c.apartment_id
      LEFT JOIN houses h ON h.id = a.house_id
      ORDER BY c.confirmed_at DESC
      LIMIT 500
    `);

    // Nach Zeitblock gruppieren
    const slots = [
      { label: 'Vor 09:00', min: 0,  max: 9  },
      { label: '09–11 Uhr', min: 9,  max: 11 },
      { label: '11–13 Uhr', min: 11, max: 13 },
      { label: '13–15 Uhr', min: 13, max: 15 },
      { label: '15–17 Uhr', min: 15, max: 17 },
      { label: 'Nach 17:00', min: 17, max: 24 },
    ];

    const counts = slots.map(s => ({
      label: s.label,
      count: rows.filter(r => r.hour >= s.min && r.hour < s.max).length,
    }));

    res.json({ total: rows.length, slots: counts, recent: rows.slice(0, 20) });
  } catch(e) { next(e); }
});

module.exports = router;
