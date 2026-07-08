const express = require('express');
const db = require('../db');
const { syncApartment } = require('../services/icalSync');
const router = express.Router();

function enrichApartments(apts) {
  if (!apts.length) return apts;
  const ids = apts.map(a => a.id);
  const ph  = ids.map(() => '?').join(',');
  const now = new Date().toISOString();

  const notes = db.prepare(
    `SELECT * FROM apartment_notes WHERE apartment_id IN (${ph}) ORDER BY created_at ASC`
  ).all(...ids);
  const notesMap = {};
  notes.forEach(n => { (notesMap[n.apartment_id] ??= []).push(n); });

  const bookings = db.prepare(`
    SELECT * FROM bookings WHERE apartment_id IN (${ph}) AND end>? ORDER BY start ASC
  `).all(...ids, now);
  const bookingsMap = {};
  bookings.forEach(b => {
    if (!bookingsMap[b.apartment_id]) bookingsMap[b.apartment_id] = [];
    if (bookingsMap[b.apartment_id].length < 3) bookingsMap[b.apartment_id].push(b);
  });

  return apts.map(a => ({
    ...a,
    notes:             notesMap[a.id]    || [],
    upcoming_bookings: bookingsMap[a.id] || [],
  }));
}

router.get('/', (req, res, next) => {
  try {
    const { status, house_id } = req.query;
    let sql = `SELECT * FROM apartments WHERE 1=1`;
    const params = [];
    if (status)   { sql += ` AND status=?`;   params.push(status); }
    if (house_id) { sql += ` AND house_id=?`; params.push(house_id); }
    sql += ` ORDER BY name`;
    res.json(enrichApartments(db.prepare(sql).all(...params)));
  } catch(e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  try {
    const apt = db.prepare(`SELECT * FROM apartments WHERE id=?`).get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const [enriched] = enrichApartments([apt]);
    res.json(enriched);
  } catch(e) { next(e); }
});

router.post('/', (req, res, next) => {
  try {
    const { name, ical_url, house_id } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    const r = db.prepare(
      `INSERT INTO apartments (name,ical_url,house_id) VALUES (?,?,?)`
    ).run(name, ical_url || null, house_id || null);
    const apt = db.prepare(`SELECT * FROM apartments WHERE id=?`).get(r.lastInsertRowid);
    const [enriched] = enrichApartments([apt]);
    if (apt.ical_url) syncApartment(apt).catch(console.error);
    res.status(201).json(enriched);
  } catch(e) { next(e); }
});

router.put('/:id', (req, res, next) => {
  try {
    const { name, ical_url, house_id } = req.body || {};
    const apt = db.prepare(`SELECT * FROM apartments WHERE id=?`).get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    db.prepare(`UPDATE apartments SET name=?,ical_url=?,house_id=? WHERE id=?`)
      .run(name ?? apt.name, ical_url ?? apt.ical_url, house_id ?? apt.house_id, req.params.id);
    const [enriched] = enrichApartments([db.prepare(`SELECT * FROM apartments WHERE id=?`).get(req.params.id)]);
    res.json(enriched);
  } catch(e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    db.prepare(`DELETE FROM apartments WHERE id=?`).run(req.params.id);
    res.status(204).end();
  } catch(e) { next(e); }
});

router.post('/:id/sync', async (req, res, next) => {
  try {
    const apt = db.prepare(`SELECT * FROM apartments WHERE id=?`).get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    await syncApartment(apt);
    const [enriched] = enrichApartments([db.prepare(`SELECT * FROM apartments WHERE id=?`).get(apt.id)]);
    res.json(enriched);
  } catch(e) { next(e); }
});

module.exports = router;
