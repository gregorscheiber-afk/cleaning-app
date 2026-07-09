const { pool } = require('../db');

// Gibt Apartments zurück die heute Anreise haben aber noch nicht sauber sind
// plan: 'wiwa' = ohne White Pearl/Cecilia, 'mainstreet' = nur White Pearl/Cecilia
async function getUncleanBeforeCheckin(plan) {
  const today = new Date().toISOString().substring(0, 10);

  let planFilter = '';
  if (plan === 'mainstreet') {
    planFilter = `AND (LOWER(h.name) LIKE '%white pearl%' OR LOWER(h.name) LIKE '%cecilia%')`;
  } else if (plan === 'wiwa') {
    planFilter = `AND NOT (LOWER(h.name) LIKE '%white pearl%' OR LOWER(h.name) LIKE '%cecilia%')`;
  }

  const { rows } = await pool.query(`
    SELECT DISTINCT a.id, a.name, h.name as house_name
    FROM apartments a
    LEFT JOIN houses h ON h.id = a.house_id
    JOIN bookings b ON b.apartment_id = a.id
    WHERE LEFT(b.start, 10) = $1
    AND a.status != 'sauber'
    ${planFilter}
    ORDER BY h.name, a.name
  `, [today]);

  return rows;
}

module.exports = { getUncleanBeforeCheckin };
