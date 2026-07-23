const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../services/auth');
const router = express.Router();

// Notizen verwaltet nur der Admin (Putztrupp/Planer bekommen sie eingebettet
// über GET /api/apartments bzw. /api/plan). Wichtig: requireAdmin pro Route,
// NICHT router.use – sonst blockiert es wegen des gemeinsamen /api-Mounts
// auch alle danach gemounteten Router.

router.get('/apartments/:id/notes', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM apartment_notes WHERE apartment_id=$1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch(e) { next(e); }
});

router.post('/apartments/:id/notes', requireAdmin, async (req, res, next) => {
  try {
    const { message, note_type } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Nachricht ist erforderlich' });
    // "team" = Notiz an den Putztrupp (Standard), "jose" = nur Admin & Planer
    const type = note_type === 'jose' ? 'jose' : 'team';
    const { rows: apt } = await pool.query(`SELECT id FROM apartments WHERE id=$1`, [req.params.id]);
    if (!apt.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const { rows } = await pool.query(
      `INSERT INTO apartment_notes (apartment_id,message,note_type) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, message.trim(), type]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

router.delete('/notes/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM apartment_notes WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch(e) { next(e); }
});

module.exports = router;
