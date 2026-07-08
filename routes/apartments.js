const express = require('express');
const db = require('../db');
const { syncApartment } = require('../services/icalSync');
const router = express.Router();

function withNotes(apts) {
  if (!apts.length) return apts;
  const ids = apts.map(a => a.id);
  const notes = db.prepare(
    `SELECT * FROM apartment_notes WHERE apartment_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC`
  ).all(...ids);
  const map = {};
  notes.forEach(n => { (map[n.apartment_id] ??= []).push(n); });
  return apts.map(a => ({ ...a, notes: map[a.id] || [] }));
}

router.get('/', (req, res) => {
  const { status, house_id } = req.query;
  let sql = `SELECT * FROM apartments WHERE 1=1`;
  const params = [];
  if (status)   { sql += ` AND status = ?`;   params.push(status); }
  if (house_id) { sql += ` AND house_id = ?`; params.push(house_id); }
  sql += ` ORDER BY name`;
  res.json(withNotes(db.prepare(sql).all(...params)));
});

router.get('/:id', (req, res) => {
  const apt = db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(req.params.id);
  if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
  apt.notes = db.prepare(`SELECT * FROM apartment_notes WHERE apartment_id = ? ORDER BY created_at ASC`).all(apt.id);
  res.json(apt);
});

router.post('/', (req, res) => {
  const { name, ical_url, house_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name ist erforderlich' });
  const result = db.prepare(
    `INSERT INTO apartments (name, ical_url, house_id) VALUES (?, ?, ?)`
  ).run(name, ical_url || null, house_id || null);
  const apt = db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(result.lastInsertRowid);
  apt.notes = [];
  if (apt.ical_url) syncApartment(apt);
  res.status(201).json(apt);
});

router.put('/:id', (req, res) => {
  const { name, ical_url, house_id } = req.body;
  const apt = db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(req.params.id);
  if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
  db.prepare(`UPDATE apartments SET name = ?, ical_url = ?, house_id = ? WHERE id = ?`)
    .run(name ?? apt.name, ical_url ?? apt.ical_url, house_id ?? apt.house_id, req.params.id);
  res.json(db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM apartments WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

router.post('/:id/sync', async (req, res) => {
  const apt = db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(req.params.id);
  if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
  await syncApartment(apt);
  res.json(db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(req.params.id));
});

module.exports = router;
