const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// GET /api/plan?from=YYYY-MM-DD&days=45
router.get('/plan', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 45;
    const from = req.query.from || new Date().toISOString().substring(0, 10);
    const to   = new Date(new Date(from).getTime() + days * 86400000)
                   .toISOString().substring(0, 10);

    // Alle Häuser + Apartments holen
    const { rows: houses } = await pool.query(
      `SELECT * FROM houses ORDER BY name`
    );

    const { rows: apartments } = await pool.query(
      `SELECT a.*, h.name as house_name
       FROM apartments a
       LEFT JOIN houses h ON h.id = a.house_id
       ORDER BY h.name, a.name`
    );

    // Buchungen im Zeitraum holen (auch Buchungen die teilweise überlappen)
    const { rows: bookings } = await pool.query(
      `SELECT b.*, a.house_id
       FROM bookings b
       JOIN apartments a ON a.id = b.apartment_id
       WHERE b.start < $1 AND b."end" > $2
       ORDER BY b.start`,
      [to, from]
    );

    // Status der Apartments
    const { rows: aptStatuses } = await pool.query(
      `SELECT id, status, checkout_time FROM apartments`
    );
    const statusMap = Object.fromEntries(aptStatuses.map(a => [a.id, a]));

    // Buchungen pro Apartment gruppieren
    const bookingsByApt = {};
    bookings.forEach(b => {
      if (!bookingsByApt[b.apartment_id]) bookingsByApt[b.apartment_id] = [];
      bookingsByApt[b.apartment_id].push(b);
    });

    // Response zusammenbauen
    const result = apartments.map(apt => ({
      ...apt,
      status: statusMap[apt.id]?.status || 'sauber',
      checkout_time: statusMap[apt.id]?.checkout_time || '09:30',
      bookings: bookingsByApt[apt.id] || [],
    }));

    res.json({ from, to, days, apartments: result });
  } catch(e) { next(e); }
});

module.exports = router;
