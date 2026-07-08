const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (_req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT h.*,
        COUNT(a.id) as total,
        SUM(CASE WHEN a.status='muss_geputzt_werden' THEN 1 ELSE 0 END) as needs_cleaning,
        SUM(CASE WHEN a.status='sauber'              THEN 1 ELSE 0 END) as clean,
        SUM(CASE WHEN a.status='belegt'              THEN 1 ELSE 0 END) as occupied
      FROM houses h
      LEFT JOIN apartments a ON a.house_id=h.id
      GROUP BY h.id ORDER BY h.name
    `).all();
    res.json(rows);
  } catch(e) { next(e); }
});

router.post('/', (req, res, next) => {
  try {
    const { name, address } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    const r = db.prepare(`INSERT INTO houses (name,address) VALUES (?,?)`).run(name, address || null);
    const house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(r.lastInsertRowid);
    res.status(201).json(house);
  } catch(e) { next(e); }
});

router.put('/:id', (req, res, next) => {
  try {
    const { name, address } = req.body || {};
    const house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(req.params.id);
    if (!house) return res.status(404).json({ error: 'Haus nicht gefunden' });
    db.prepare(`UPDATE houses SET name=?,address=? WHERE id=?`)
      .run(name ?? house.name, address ?? house.address, req.params.id);
    res.json(db.prepare(`SELECT * FROM houses WHERE id=?`).get(req.params.id));
  } catch(e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    db.prepare(`DELETE FROM houses WHERE id=?`).run(req.params.id);
    res.status(204).end();
  } catch(e) { next(e); }
});

module.exports = router;
