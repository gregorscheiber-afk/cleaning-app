const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT h.*,
      COUNT(a.id) as total,
      SUM(CASE WHEN a.status = 'muss_geputzt_werden' THEN 1 ELSE 0 END) as needs_cleaning,
      SUM(CASE WHEN a.status = 'sauber'              THEN 1 ELSE 0 END) as clean,
      SUM(CASE WHEN a.status = 'belegt'              THEN 1 ELSE 0 END) as occupied
    FROM houses h
    LEFT JOIN apartments a ON a.house_id = h.id
    GROUP BY h.id ORDER BY h.name
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const house = db.prepare(`SELECT * FROM houses WHERE id = ?`).get(req.params.id);
  if (!house) return res.status(404).json({ error: 'Haus nicht gefunden' });
  res.json(house);
});

router.post('/', (req, res) => {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ error: 'name ist erforderlich' });
  const result = db.prepare(`INSERT INTO houses (name, address) VALUES (?, ?)`).run(name, address || null);
  res.status(201).json(db.prepare(`SELECT * FROM houses WHERE id = ?`).get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, address } = req.body;
  const house = db.prepare(`SELECT * FROM houses WHERE id = ?`).get(req.params.id);
  if (!house) return res.status(404).json({ error: 'Haus nicht gefunden' });
  db.prepare(`UPDATE houses SET name = ?, address = ? WHERE id = ?`)
    .run(name ?? house.name, address ?? house.address, req.params.id);
  res.json(db.prepare(`SELECT * FROM houses WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM houses WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

module.exports = router;
