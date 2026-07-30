const express = require('express');
const { pool } = require('../db');
const { recomputeStatus, recomputeAll } = require('../services/icalSync');
const { notifyApartmentClean } = require('../services/notify');
const { requireAdmin } = require('../services/auth');
const router = express.Router();

router.post('/apartments/:id/confirm-clean', async (req, res, next) => {
  try {
    const { cleaner_name, note } = req.body || {};
    if (!cleaner_name) return res.status(400).json({ error: 'cleaner_name ist erforderlich' });
    const { rows } = await pool.query(`SELECT a.*, h.name as house_name FROM apartments a LEFT JOIN houses h ON h.id=a.house_id WHERE a.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const apt = rows[0];
    await pool.query(
      `INSERT INTO cleanings (apartment_id,cleaner_name,note) VALUES ($1,$2,$3)`,
      [apt.id, cleaner_name, note || null]
    );
    // Nur Putzfrau-Notizen löschen – José-Notizen bleiben, bis der Admin sie entfernt
    await pool.query(
      `DELETE FROM apartment_notes WHERE apartment_id=$1 AND (note_type IS NULL OR note_type != 'jose')`,
      [apt.id]
    );
    const newStatus = await recomputeStatus(apt.id);
    await notifyApartmentClean(apt, cleaner_name);
    const { rows: updated } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [apt.id]);
    res.json({ apartment: updated[0], status: newStatus });
  } catch(e) { next(e); }
});

router.get('/notifications', requireAdmin, async (req, res, next) => {
  try {
    const { since } = req.query;
    const { rows } = since
      ? await pool.query(`SELECT * FROM notifications WHERE created_at>$1 ORDER BY created_at DESC`, [since])
      : await pool.query(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`);
    res.json(rows);
  } catch(e) { next(e); }
});

router.get('/cleanings', requireAdmin, async (req, res, next) => {
  try {
    const { apartment_id } = req.query;
    const { rows } = apartment_id
      ? await pool.query(`SELECT * FROM cleanings WHERE apartment_id=$1 ORDER BY confirmed_at DESC`, [apartment_id])
      : await pool.query(`SELECT * FROM cleanings ORDER BY confirmed_at DESC LIMIT 100`);
    res.json(rows);
  } catch(e) { next(e); }
});

// POST /api/reset-cleaning-log – Reinigungslog & Bestätigungen auf 0 setzen
// (z. B. zum Saisonstart). Achtung: Apartments, deren letzte Reinigung
// damit gelöscht wird, springen zurück auf "muss_geputzt_werden", bis das
// Team sie neu bestätigt.
router.post('/reset-cleaning-log', requireAdmin, async (_req, res, next) => {
  try {
    const { rowCount: cleanings }     = await pool.query(`DELETE FROM cleanings`);
    const { rowCount: notifications } = await pool.query(`DELETE FROM notifications`);
    await recomputeAll();
    console.log(`Reinigungslog zurückgesetzt: ${cleanings} Reinigungen, ${notifications} Benachrichtigungen gelöscht.`);
    res.json({ ok: true, cleanings, notifications });
  } catch(e) { next(e); }
});

// GET /api/cleanings/stats – Reinigungszeiten Statistik
router.get('/cleanings/stats', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.confirmed_at,
        a.name as apt_name,
        h.name as house_name,
        EXTRACT(HOUR   FROM c.confirmed_at AT TIME ZONE 'Europe/Vienna') * 60
      + EXTRACT(MINUTE FROM c.confirmed_at AT TIME ZONE 'Europe/Vienna') as minute
      FROM cleanings c
      JOIN apartments a ON a.id = c.apartment_id
      LEFT JOIN houses h ON h.id = a.house_id
      ORDER BY c.confirmed_at DESC
      LIMIT 500
    `);

    // Nach Zeitblock gruppieren (Minuten seit Mitternacht, Wiener Zeit).
    // "Vor 08:00" fängt frühe Reinigungen ab, damit keine Daten unsichtbar
    // werden; die restlichen Fenster wie vom Büro gewünscht.
    const slots = [
      { label: 'Vor 08:00',      min: 0,    max: 480  },
      { label: '08:00–10:00',    min: 480,  max: 600  },
      { label: '10:00–12:00',    min: 600,  max: 720  },
      { label: '12:00–14:00',    min: 720,  max: 840  },
      { label: '14:00–15:00',    min: 840,  max: 900  },
      { label: '15:00–16:00',    min: 900,  max: 960  },
      { label: '16:00–16:30',    min: 960,  max: 990  },
      { label: 'Nach 16:30',     min: 990,  max: 1440 },
    ];

    const counts = slots.map(s => ({
      label: s.label,
      count: rows.filter(r => Number(r.minute) >= s.min && Number(r.minute) < s.max).length,
    }));

    res.json({ total: rows.length, slots: counts, recent: rows.slice(0, 20) });
  } catch(e) { next(e); }
});

module.exports = router;
