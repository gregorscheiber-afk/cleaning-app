const { pool } = require('../db');
const { planCondition } = require('./planFilter');

// Gibt Apartments zurück, die heute Anreise haben UND noch geputzt werden
// müssen (Status 'muss_geputzt_werden'). Wichtig: NICHT einfach "!= sauber"
// verwenden – ein frisch gereinigtes Apartment mit Anreise heute wechselt ab
// der Check-in-Zeit auf 'belegt' (Gast eingecheckt); das ist KEIN Alarm.
// Ein wirklich ungereinigtes Apartment mit heutigem Checkout bleibt dagegen
// (per Vorrang in recomputeStatus) auf 'muss_geputzt_werden'.
// plan: 'wiwa' = ohne White Pearl/Cecilia, 'mainstreet' = nur White Pearl/Cecilia
async function getUncleanBeforeCheckin(plan) {
  const today = new Date().toISOString().substring(0, 10);

  const cond = planCondition(plan);
  const planFilter = cond ? `AND ${cond}` : '';

  const { rows } = await pool.query(`
    SELECT DISTINCT a.id, a.name, h.name as house_name
    FROM apartments a
    LEFT JOIN houses h ON h.id = a.house_id
    JOIN bookings b ON b.apartment_id = a.id
    WHERE LEFT(b.start, 10) = $1
    AND a.status = 'muss_geputzt_werden'
    ${planFilter}
    ORDER BY h.name, a.name
  `, [today]);

  return rows;
}

module.exports = { getUncleanBeforeCheckin };
