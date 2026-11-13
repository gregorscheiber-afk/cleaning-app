const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Anreisen eines Tages (Standard: heute, Europa/Wien). Offen wie der Planer.
function todayVienna() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
}

// GET /api/arrivals?date=YYYY-MM-DD
router.get('/arrivals', async (req, res, next) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayVienna();

    const { rows: arrivals } = await pool.query(
      `SELECT b.id, b.guest_name, b.persons,
              LEFT(b.start,10) AS start, LEFT(b."end",10) AS "end",
              a.id AS apartment_id, a.name AS apartment_name, a.pms_code, a.checkout_time,
              h.name AS house_name
         FROM bookings b
         JOIN apartments a ON a.id = b.apartment_id
         LEFT JOIN houses h ON h.id = a.house_id
        WHERE LEFT(b.start,10) = $1
        ORDER BY h.name, a.name`,
      [date]
    );

    // Zusatzleistungen (Anker: Apartment + Anreisedatum)
    if (arrivals.length) {
      const ids = [...new Set(arrivals.map(a => a.apartment_id))];
      const ph = ids.map((_, i) => `$${i + 1}`).join(',');
      const { rows: services } = await pool.query(
        `SELECT * FROM booking_services WHERE apartment_id IN (${ph})`, ids
      );
      const svcMap = {};
      services.forEach(s => { svcMap[`${s.apartment_id}|${String(s.start).substring(0, 10)}`] = s; });
      arrivals.forEach(a => {
        const svc = svcMap[`${a.apartment_id}|${a.start}`];
        a.breakfast     = svc?.breakfast     || null;
        a.interim_clean = svc?.interim_clean || null;
        a.baby_cot      = svc?.baby_cot      || null;
        a.high_chair    = svc?.high_chair    || null;
      });
    }

    res.json({ date, arrivals });
  } catch (e) { next(e); }
});

module.exports = router;
