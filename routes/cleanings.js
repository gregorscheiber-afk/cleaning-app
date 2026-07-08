const express = require('express');
const db = require('../db');
const { recomputeStatus } = require('../services/icalSync');
const { notifyApartmentClean } = require('../services/notify');
const router = express.Router();

router.post('/apartments/:id/confirm-clean', async (req, res, next) => {
  try {
    const { cleaner_name, note } = req.body || {};
    if (!cleaner_name) return res.status(400).json({ error: 'cleaner_name ist erforderlich' });
    const apt = db.prepare(`SELECT * FROM apartments WHERE id=?`).get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    db.prepare(`INSERT INTO cleanings (apartment_id,cleaner_name,note) VALUES (?,?,?)`)
      .run(apt.id, cleaner_name, note || null);
    db.prepare(`DELETE FROM apartment_notes WHERE apartment_id=?`).run(apt.id);
    const newStatus = recomputeStatus(apt.id);
    await notifyApartmentClean(apt, cleaner_name);
    res.json({ apartment: db.prepare(`SELECT * FROM apartments WHERE id=?`).get(apt.id), status: newStatus });
  } catch(e) { next(e); }
});

router.get('/notifications', (req, res, next) => {
  try {
    const { since } = req.query;
    const rows = since
      ? db.prepare(`SELECT * FROM notifications WHERE created_at>? ORDER BY created_at DESC`).all(since)
      : db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`).all();
    res.json(rows);
  } catch(e) { next(e); }
});

router.get('/cleanings', (req, res, next) => {
  try {
    const { apartment_id } = req.query;
    const rows = apartment_id
      ? db.prepare(`SELECT * FROM cleanings WHERE apartment_id=? ORDER BY confirmed_at DESC`).all(apartment_id)
      : db.prepare(`SELECT * FROM cleanings ORDER BY confirmed_at DESC LIMIT 100`).all();
    res.json(rows);
  } catch(e) { next(e); }
});

module.exports = router;
