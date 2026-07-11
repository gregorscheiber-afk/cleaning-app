const express = require('express');
const { pool } = require('../db');
const { getUncleanBeforeCheckin } = require('../services/cleaningAlert');
const router = express.Router();

// GET /api/plan?from=YYYY-MM-DD&days=45&house_id=X&plan=wiwa|mainstreet
router.get('/plan', async (req, res, next) => {
  try {
    const days    = parseInt(req.query.days) || 45;
    const from    = req.query.from || new Date().toISOString().substring(0, 10);
    const to      = new Date(new Date(from).getTime() + days * 86400000).toISOString().substring(0, 10);
    const houseId = req.query.house_id || null;
    const plan    = req.query.plan || 'wiwa'; // wiwa=alle, mainstreet=gefiltert

    // Häuser laden
    let houseSql = `SELECT * FROM houses ORDER BY name`;
    const { rows: allHouses } = await pool.query(houseSql);

    // Apartments mit Hausinfo
    let aptSql = `SELECT a.*, h.name as house_name FROM apartments a LEFT JOIN houses h ON h.id=a.house_id WHERE 1=1`;
    const aptParams = [];

    if (plan === 'mainstreet') {
      // Nur Chalet White Pearl + Chalet Cecilia
      aptSql += ` AND (LOWER(h.name) LIKE '%white pearl%' OR LOWER(h.name) LIKE '%cecilia%')`;
    } else if (plan === 'wiwa') {
      // WIWA = alle AUSSER White Pearl und Cecilia
      aptSql += ` AND NOT (LOWER(h.name) LIKE '%white pearl%' OR LOWER(h.name) LIKE '%cecilia%')`;
      if (houseId) { aptParams.push(houseId); aptSql += ` AND a.house_id=$${aptParams.length}`; }
    } else if (houseId) {
      aptParams.push(houseId);
      aptSql += ` AND a.house_id=$${aptParams.length}`;
    }

    aptSql += ` ORDER BY h.name, a.name`;
    const { rows: apartments } = await pool.query(aptSql, aptParams);

    // Buchungen im Zeitraum
    const ids = apartments.map(a => a.id);
    let bookings = [];
    if (ids.length) {
      const ph = ids.map((_,i) => `$${i+1}`).join(',');
      const { rows } = await pool.query(
        `SELECT * FROM bookings WHERE apartment_id IN (${ph}) AND start<$${ids.length+1} AND "end">$${ids.length+2} ORDER BY start`,
        [...ids, to, from]
      );
      bookings = rows;
    }

    const bookingsByApt = {};
    bookings.forEach(b => { (bookingsByApt[b.apartment_id] ??= []).push(b); });

    const result = apartments.map(apt => ({
      ...apt,
      bookings: bookingsByApt[apt.id] || [],
      notes: notesByApt[apt.id] || [],
    }));

    res.json({ from, to, days, plan, apartments: result, houses: allHouses });
  } catch(e) { next(e); }
});

// GET /api/cleaning-alert?plan=wiwa|mainstreet
router.get('/cleaning-alert', async (req, res, next) => {
  try {
    const rows = await getUncleanBeforeCheckin(req.query.plan || 'wiwa');
    res.json(rows);
  } catch(e) { next(e); }
});

module.exports = router;
