const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Tages-Einteilung der Reinigung. Bewusst OHNE Login-Pflicht – die Einteilung
// passiert in der (offenen) Planer-Ansicht, so wie die Reinigungsbestätigung
// in der offenen Putztrupp-Ansicht.

// GET /api/assignments?from=YYYY-MM-DD&to=YYYY-MM-DD
// Liefert die eingeteilten Apartment-IDs pro Tag im Zeitraum (für den Planer).
router.get('/assignments', async (req, res, next) => {
  try {
    const from = req.query.from || new Date().toISOString().substring(0, 10);
    const to   = req.query.to   || from;
    const { rows } = await pool.query(
      `SELECT apartment_id, date FROM cleaning_assignments WHERE date>=$1 AND date<=$2`,
      [from, to]
    );
    res.json(rows);
  } catch(e) { next(e); }
});

// PUT /api/assignments  { apartment_id, date, assigned: true|false }
// Schaltet die Einteilung eines Apartments für einen Tag an oder aus.
router.put('/assignments', async (req, res, next) => {
  try {
    const { apartment_id, date, assigned } = req.body || {};
    if (!apartment_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'apartment_id und gültiges date sind erforderlich' });
    }
    if (assigned) {
      await pool.query(
        `INSERT INTO cleaning_assignments (apartment_id, date) VALUES ($1,$2)
         ON CONFLICT (apartment_id, date) DO NOTHING`,
        [apartment_id, date]
      );
    } else {
      await pool.query(
        `DELETE FROM cleaning_assignments WHERE apartment_id=$1 AND date=$2`,
        [apartment_id, date]
      );
    }
    res.json({ apartment_id, date, assigned: !!assigned });
  } catch(e) { next(e); }
});

module.exports = router;
