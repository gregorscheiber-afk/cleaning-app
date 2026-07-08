const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/apartments/:id/notes', (req, res) => {
  res.json(db.prepare(
    `SELECT * FROM apartment_notes WHERE apartment_id = ? ORDER BY created_at DESC`
  ).all(req.params.id));
});

router.post('/apartments/:id/notes', (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message ist erforderlich' });
  const apt = db.prepare(`SELECT id FROM apartments WHERE id = ?`).get(req.params.id);
  if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
  const result = db.prepare(
    `INSERT INTO apartment_notes (apartment_id, message) VALUES (?, ?)`
  ).run(req.params.id, message.trim());
  res.status(201).json(db.prepare(`SELECT * FROM apartment_notes WHERE id = ?`).get(result.lastInsertRowid));
});

router.delete('/notes/:id', (req, res) => {
  db.prepare(`DELETE FROM apartment_notes WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

module.exports = router;
