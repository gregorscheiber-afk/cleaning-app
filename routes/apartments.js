const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../services/auth');
const router = express.Router();

async function enrichApartments(apts) {
  if (!apts.length) return apts;
  const ids = apts.map(a => a.id);
  const ph  = ids.map((_,i) => `$${i+1}`).join(',');
  const now = new Date().toISOString();

  const { rows: notes } = await pool.query(
    `SELECT * FROM apartment_notes WHERE apartment_id IN (${ph}) ORDER BY created_at ASC`, ids
  );
  // Notizen trennen: "team" geht an den Putztrupp (offene Ansicht!),
  // "jose" ist nur für Admin & Planer bestimmt
  const notesMap = {};
  const joseMap  = {};
  notes.forEach(n => {
    if (n.note_type === 'jose') (joseMap[n.apartment_id] ??= []).push(n);
    else                        (notesMap[n.apartment_id] ??= []).push(n);
  });

  const { rows: bookings } = await pool.query(
    `SELECT * FROM bookings WHERE apartment_id IN (${ph}) AND "end">$${ids.length+1} ORDER BY start ASC`,
    [...ids, now]
  );

  // Zusatzleistungen (Frühstück/Zwischenreinigung) den Buchungen zuordnen
  const { rows: services } = await pool.query(
    `SELECT * FROM booking_services WHERE apartment_id IN (${ph})`, ids
  );
  const svcMap = {};
  services.forEach(s => { svcMap[`${s.apartment_id}|${s.start}`] = s; });

  const bookingsMap = {};
  bookings.forEach(b => {
    const svc = svcMap[`${b.apartment_id}|${String(b.start).substring(0,10)}`];
    b.breakfast     = svc?.breakfast     || null;
    b.interim_clean = svc?.interim_clean || null;
    if (!bookingsMap[b.apartment_id]) bookingsMap[b.apartment_id] = [];
    if (bookingsMap[b.apartment_id].length < 2) bookingsMap[b.apartment_id].push(b);
  });

  return apts.map(a => ({
    ...a,
    notes:             notesMap[a.id]    || [],
    jose_notes:        joseMap[a.id]     || [],
    upcoming_bookings: bookingsMap[a.id] || [],
  }));
}

router.get('/', async (req, res, next) => {
  try {
    const { status, house_id, assigned_date, plan } = req.query;
    // house_name mitliefern, damit die Reinigungsansicht bei der
    // hausübergreifenden Einteilung anzeigen kann, wo das Apartment liegt
    let sql = `SELECT a.*, h.name AS house_name
               FROM apartments a
               LEFT JOIN houses h ON h.id = a.house_id
               WHERE 1=1`;
    const params = [];
    if (status)   { params.push(status);   sql += ` AND a.status=$${params.length}`; }
    if (house_id) { params.push(house_id); sql += ` AND a.house_id=$${params.length}`; }

    // Nur Apartments, die für diesen Tag zum Reinigen eingeteilt sind
    if (assigned_date) {
      params.push(assigned_date);
      sql += ` AND a.id IN (SELECT apartment_id FROM cleaning_assignments WHERE date=$${params.length})`;
    }

    // Plan-Filter (wie im Planer): mainstreet = White Pearl/Cecilia, wiwa = Rest
    if (plan === 'mainstreet') {
      sql += ` AND (LOWER(h.name) LIKE '%white pearl%' OR LOWER(h.name) LIKE '%cecilia%')`;
    } else if (plan === 'wiwa') {
      sql += ` AND (h.name IS NULL OR NOT (LOWER(h.name) LIKE '%white pearl%' OR LOWER(h.name) LIKE '%cecilia%'))`;
    }

    sql += ` ORDER BY h.name, a.name`;
    const { rows } = await pool.query(sql, params);
    res.json(await enrichApartments(rows));
  } catch(e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const [enriched] = await enrichApartments(rows);
    res.json(enriched);
  } catch(e) { next(e); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, house_id, pms_code, checkout_time } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    const { rows } = await pool.query(
      `INSERT INTO apartments (name,house_id,pms_code,checkout_time) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, house_id||null, pms_code||null, checkout_time||'09:30']
    );
    const [enriched] = await enrichApartments(rows);
    res.status(201).json(enriched);
  } catch(e) { next(e); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, house_id, pms_code, checkout_time } = req.body || {};
    const { rows: existing } = await pool.query(`SELECT * FROM apartments WHERE id=$1`, [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Apartment nicht gefunden' });
    const a = existing[0];
    const { rows } = await pool.query(
      `UPDATE apartments SET name=$1,house_id=$2,pms_code=$3,checkout_time=$4 WHERE id=$5 RETURNING *`,
      [name??a.name, house_id??a.house_id, pms_code??a.pms_code, (checkout_time??a.checkout_time)||'09:30', req.params.id]
    );
    const [enriched] = await enrichApartments(rows);
    res.json(enriched);
  } catch(e) { next(e); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM apartments WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch(e) { next(e); }
});

module.exports = router;
