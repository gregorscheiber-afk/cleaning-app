const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../services/auth');
const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT h.*,
        COUNT(a.id)::int as total,
        SUM(CASE WHEN a.status='muss_geputzt_werden' THEN 1 ELSE 0 END)::int as needs_cleaning,
        SUM(CASE WHEN a.status='sauber'              THEN 1 ELSE 0 END)::int as clean,
        SUM(CASE WHEN a.status='belegt'              THEN 1 ELSE 0 END)::int as occupied
      FROM houses h
      LEFT JOIN apartments a ON a.house_id=h.id
      GROUP BY h.id ORDER BY h.name
    `);
    res.json(rows);
  } catch(e) { next(e); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, address } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    const { rows } = await pool.query(
      `INSERT INTO houses (name,address) VALUES ($1,$2) RETURNING *`,
      [name, address || null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, address } = req.body || {};
    const { rows: existing } = await pool.query(`SELECT * FROM houses WHERE id=$1`, [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Haus nicht gefunden' });
    const h = existing[0];
    const { rows } = await pool.query(
      `UPDATE houses SET name=$1,address=$2 WHERE id=$3 RETURNING *`,
      [name ?? h.name, address ?? h.address, req.params.id]
    );
    res.json(rows[0]);
  } catch(e) { next(e); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM houses WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch(e) { next(e); }
});

module.exports = router;
