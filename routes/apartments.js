const express = require('express');
const db = require('../db');
const { syncApartment } = require('../services/icalSync');
const router = express.Router();

function enrichApartments(apts) {
  if (!apts.length) return apts;
  const ids = apts.map(a => a.id);
  const placeholders = ids.map(() => '?').join(',');
  const now = new Date().toISOString();

  // Notizen
  const notes = db.prepare(
    `SELECT * FROM apartment_notes WHERE apartment_id IN (${placeholders}) ORDER BY created_at ASC`
  ).all(...ids);
  const notesMap = {};
  notes.forEach(n => { (notesMap[n.apartment_id] ??= []).push(n); });

  // Nächste 3 Buchungen pro Apartment
  const bookings = db.prepare(`
    SELECT * FROM bookings
    WHERE apartment_id IN (${placeholders})
      AND end > ?
    ORDER BY start ASC
  `).all(...ids, now);

  const bookingsMap = {};
  bookings.forEach(b => {
    if (!bookingsMap[b.apartment_id]) bookingsMap[b.apartment_id] = [];
    if (bookingsMap[b.apartment_id].length < 3) bookingsMap[b.apartment_id].push(b);
  });

  return apts.map(a => ({
    ...a,
    notes:           notesMap[a.id]    || [],
    upcoming_bookings: bookingsMap[a.id] || [],
  }));
}

router.get('/', (req, res) => {
  const { status, house_id } = req.query;
  let sql = `SELECT * FROM apartments WHERE 1=1`;
  const params = [];
  if (status)   { sql += ` AND status = ?`;   params.push(status); }
  if (house_id) { sql += ` AND house_id = ?`; params.push(house_id); }
  sql += ` ORDER BY name`;
  res.json(enrichApartments(db.prepare(sql).all(...params)));
});

router.get('/:id', (req, res) => {
  const apt = db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(req.params.id);
  if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
  const [enriched] = enrichApartments([apt]);
  res.json(enriched);
});

router.post('/', (req, res) => {
  const { name, ical_url, house_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name ist erforderlich' });
  const result = db.prepare(
    `INSERT INTO apartments (name, ical_url, house_id) VALUES (?, ?, ?)`
  ).run(name, ical_url || null, house_id || null);
  const apt = db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(result.lastInsertRowid);
  apt.notes = []; apt.upcoming_bookings = [];
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
  const [enriched] = enrichApartments([db.prepare(`SELECT * FROM apartments WHERE id = ?`).get(apt.id)]);
  res.json(enriched);
});

module.exports = router;
