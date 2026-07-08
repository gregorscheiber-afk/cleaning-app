const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/apartments/:id/notes', (req, res, next) => {
  try {
    res.json(db.prepare(
      `SELECT * FROM apartment_notes WHERE apartment_id=? ORDER BY created_at DESC`
    ).all(req.params.id));
  } catch(e) { next(e); }
});

router.post('/apartments/:id/notes', (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Nachricht ist erforderlich' });
    const apt = db.prepare(`SELECT id FROM apartments WHERE id=?`).get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const r = db.prepare(
      `INSERT INTO apartment_notes (apartment_id,message) VALUES (?,?)`
    ).run(req.params.id, message.trim());
    res.status(201).json(db.prepare(`SELECT * FROM apartment_notes WHERE id=?`).get(r.lastInsertRowid));
  } catch(e) { next(e); }
});

router.delete('/notes/:id', (req, res, next) => {
  try {
    db.prepare(`DELETE FROM apartment_notes WHERE id=?`).run(req.params.id);
    res.status(204).end();
  } catch(e) { next(e); }
});

module.exports = router;
