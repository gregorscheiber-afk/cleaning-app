const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../services/auth');
const router = express.Router();

// Schadens-/Reparaturmeldungen.
//  - Putzkraft meldet ungeschützt (POST /api/defects).
//  - Admin liest/erledigt/löscht (requireAdmin pro Route, NICHT router.use –
//    wegen des gemeinsamen /api-Mounts).

const CATEGORIES = ['light', 'water', 'furniture', 'key', 'other'];

// ── Putzkraft: Schaden melden (ohne Login) ──────────────────
router.post('/defects', async (req, res, next) => {
  try {
    const { apartment_id, category, message, reporter, photo } = req.body || {};
    if (!apartment_id) return res.status(400).json({ error: 'Apartment fehlt' });
    const cat = CATEGORIES.includes(category) ? category : 'other';
    const clean = s => (s && String(s).trim() ? String(s).trim() : null);
    // ohne Text UND ohne Foto ist es keine sinnvolle Meldung, außer Kategorie
    const { rows: apt } = await pool.query(`SELECT id FROM apartments WHERE id=$1`, [apartment_id]);
    if (!apt.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    // Foto-Größe begrenzen (Schutz vor Riesen-Uploads): ~1.5 MB data-URL
    const ph = typeof photo === 'string' && photo.startsWith('data:image/') && photo.length < 1_600_000 ? photo : null;
    const { rows } = await pool.query(
      `INSERT INTO defects (apartment_id, category, message, reporter, photo, status)
       VALUES ($1,$2,$3,$4,$5,'open') RETURNING id`,
      [apartment_id, cat, clean(message), clean(reporter), ph]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) { next(e); }
});

// ── Admin: Meldungen auflisten ──────────────────────────────
// ?status=open (Standard) | done | all
router.get('/defects', requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status || 'open';
    const cond = status === 'all' ? '' : `WHERE d.status = $1`;
    const params = status === 'all' ? [] : [status];
    const { rows } = await pool.query(
      `SELECT d.*, a.name AS apartment_name, a.house_id, h.name AS house_name
         FROM defects d
         JOIN apartments a ON a.id = d.apartment_id
         LEFT JOIN houses h ON h.id = a.house_id
         ${cond}
        ORDER BY d.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── Admin: als erledigt / wieder offen markieren ────────────
router.patch('/defects/:id', requireAdmin, async (req, res, next) => {
  try {
    const done = req.body?.status === 'done';
    const { rows } = await pool.query(
      `UPDATE defects SET status=$1, resolved_at=$2 WHERE id=$3 RETURNING *`,
      [done ? 'done' : 'open', done ? new Date().toISOString() : null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Meldung nicht gefunden' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── Admin: löschen ──────────────────────────────────────────
router.delete('/defects/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM defects WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
