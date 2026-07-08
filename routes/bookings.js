const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// PUT /api/bookings/:id/persons  { adults, children, babies }
router.put('/bookings/:id/persons', async (req, res, next) => {
  try {
    const { adults = 0, children = 0, babies = 0 } = req.body || {};
    const parts = [];
    if (Number(adults)   > 0) parts.push(`${adults} Erw.`);
    if (Number(children) > 0) parts.push(`${children} Kind${Number(children)>1?'er':''}`);
    if (Number(babies)   > 0) parts.push(`${babies} Baby${Number(babies)>1?'s':''}`);
    const persons = parts.join(' · ') || null;

    await pool.query(`UPDATE bookings SET persons=$1 WHERE id=$2`, [persons, req.params.id]);

    // Rohdaten zurückgeben damit das Frontend die Felder korrekt befüllen kann
    res.json({ id: req.params.id, persons, adults: Number(adults), children: Number(children), babies: Number(babies) });
  } catch(e) { next(e); }
});

module.exports = router;
