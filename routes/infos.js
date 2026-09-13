const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../services/auth');
const { plansForHouseName } = require('../services/planFilter');
const router = express.Router();

// Info-Pop-ups für die Reinigungsansicht.
//  - Admin verwaltet sie (requireAdmin pro Route, NICHT router.use – wegen des
//    gemeinsamen /api-Mounts).
//  - Die Putzkraft holt aktive Infos ungeschützt über GET /api/active-infos.

const FREQ = ['daily', 'weekly', 'biweekly'];
const PLANS = ['wiwa', 'mainstreet', 'sonja', 'helga'];
const KINDS = ['normal', 'update'];

// Heutiges Datum in Europa/Wien als YYYY-MM-DD (sv-SE liefert ISO-Format).
function todayVienna() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
}
function addDays(dateStr, n) {
  return new Date(new Date(dateStr).getTime() + n * 86400000).toISOString().substring(0, 10);
}

// ── Admin: alle Infos auflisten ─────────────────────────────
router.get('/infos', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, h.name AS house_name
         FROM reinigung_infos i
         LEFT JOIN houses h ON h.id = i.house_id
        ORDER BY i.created_at DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── Admin: neue Info anlegen ────────────────────────────────
router.post('/infos', requireAdmin, async (req, res, next) => {
  try {
    const { message, message_hr, message_tr, message_en, house_id, plan, frequency, kind } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'Text (Deutsch) ist erforderlich' });
    const freq = FREQ.includes(frequency) ? frequency : 'daily';
    const kindVal = KINDS.includes(kind) ? kind : 'normal';
    // Ziel: entweder ein Plan, oder ein einzelnes Haus, oder alle Häuser.
    const planVal = PLANS.includes(plan) ? plan : null;
    const houseId = !planVal && house_id ? parseInt(house_id) : null;
    const clean = s => (s && s.trim() ? s.trim() : null);   // leere Felder → NULL (Fallback Deutsch)
    const start = todayVienna();
    const end = addDays(start, 30);           // Laufzeit fix 30 Tage
    const { rows } = await pool.query(
      `INSERT INTO reinigung_infos (message, message_hr, message_tr, message_en, house_id, plan, frequency, kind, start_date, end_date, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1) RETURNING *`,
      [message.trim(), clean(message_hr), clean(message_tr), clean(message_en), houseId, planVal, freq, kindVal, start, end]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ── Admin: aktiv/inaktiv schalten ───────────────────────────
router.patch('/infos/:id', requireAdmin, async (req, res, next) => {
  try {
    const active = req.body?.active ? 1 : 0;
    const { rows } = await pool.query(
      `UPDATE reinigung_infos SET active=$1 WHERE id=$2 RETURNING *`,
      [active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Info nicht gefunden' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── Admin: löschen ──────────────────────────────────────────
router.delete('/infos/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM reinigung_infos WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Putzkraft: aktive Infos für ein Haus (ohne Login) ───────
// Liefert Infos, die heute laufen und für dieses Haus (oder alle) gelten.
router.get('/active-infos', async (req, res, next) => {
  try {
    const today = todayVienna();
    const houseId = req.query.house_id ? parseInt(req.query.house_id) : null;

    // Zu welchen Plänen gehört dieses Haus? (für plan-weite Infos)
    let plansOfHouse = [];
    if (houseId) {
      const { rows: hr } = await pool.query(`SELECT name FROM houses WHERE id=$1`, [houseId]);
      if (hr.length) plansOfHouse = plansForHouseName(hr[0].name);
    }

    // Ziel-Bedingungen: alle Häuser ODER dieses Haus ODER ein Plan des Hauses
    const params = [today];
    const conds = [`(house_id IS NULL AND plan IS NULL)`];   // alle Häuser
    if (houseId) { params.push(houseId); conds.push(`house_id = $${params.length}`); }
    if (plansOfHouse.length) {
      const ph = plansOfHouse.map(p => { params.push(p); return `$${params.length}`; });
      conds.push(`plan IN (${ph.join(',')})`);
    }

    const { rows } = await pool.query(
      `SELECT id, message, message_hr, message_tr, message_en, frequency, kind, start_date
         FROM reinigung_infos
        WHERE active = 1 AND start_date <= $1 AND end_date >= $1 AND (${conds.join(' OR ')})
        ORDER BY created_at ASC`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
