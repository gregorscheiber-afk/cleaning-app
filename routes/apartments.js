const express = require('express');
const { pool } = require('../db');
const { syncApartment } = require('../services/icalSync');
const router = express.Router();

async function enrichApartments(apts) {
  if (!apts.length) return apts;
  const ids = apts.map(a => a.id);
  const ph  = ids.map((_,i) => `$${i+1}`).join(',');
  const now = new Date().toISOString();

  const { rows: notes } = await pool.query(
    `SELECT * FROM apartment_notes WHERE apartment_id IN (${ph}) ORDER BY created_at ASC`, ids
  );
  const notesMap = {};
  notes.forEach(n => { (notesMap[n.apartment_id] ??= []).push(n); });

  const { rows: bookings } = await pool.query(
    `SELECT * FROM bookings WHERE apartment_id IN (${ph}) AND "end">$${ids.length+1} ORDER BY start ASC`,
    [...ids, now]
  );
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

router.get('/', async (req, res, next) => {
  try {
    const { status, house_id } = req.query;
    let sql = `SELECT * FROM apartments WHERE 1=1`;
    const params = [];
    if (status)   { params.push(status);   sql += ` AND status=$${params.length}`; }
    if (house_id) { params.push(house_id); sql += ` AND house_id=$${params.length}`; }
    sql += ` ORDER BY name`;
    const { rows } = await pool.query(sql, params);
    res.json(await enrichApartments(rows));
  } catch(e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const [enriched] = await enrichApartments(rows);
    res.json(enriched);
  } catch(e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, ical_url, house_id, pms_code } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    const { rows } = await pool.query(
      `INSERT INTO apartments (name,ical_url,house_id,pms_code) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, ical_url || null, house_id || null, pms_code || null]
    );
    const [enriched] = await enrichApartments(rows);
    if (rows[0].ical_url) syncApartment(rows[0]).catch(console.error);
    res.status(201).json(enriched);
  } catch(e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, ical_url, house_id, pms_code } = req.body || {};
    const { rows: existing } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const a = existing[0];
    const { rows } = await pool.query(
      `UPDATE apartments SET name=$1,ical_url=$2,house_id=$3,pms_code=$4 WHERE id=$5 RETURNING *`,
      [name ?? a.name, ical_url ?? a.ical_url, house_id ?? a.house_id, pms_code ?? a.pms_code, req.params.id]
    );
    const [enriched] = await enrichApartments(rows);
    res.json(enriched);
  } catch(e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM apartments WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch(e) { next(e); }
});

router.post('/:id/sync', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    await syncApartment(rows[0]);
    const { rows: updated } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [req.params.id]);
    const [enriched] = await enrichApartments(updated);
    res.json(enriched);
  } catch(e) { next(e); }
});

module.exports = router;
