// iCal-Sync wurde entfernt – Buchungen werden über Excel importiert.
// Diese Datei enthält nur noch recomputeStatus (wird nach Excel-Import und Reinigungen benötigt).

const { pool } = require('../db');

async function recomputeStatus(apartmentId) {
  const now = new Date();
  const nowIso = now.toISOString();

  const { rows: aptRows } = await pool.query(
    `SELECT checkout_time FROM apartments WHERE id=$1`, [apartmentId]
  );
  const checkoutTime = aptRows[0]?.checkout_time || '09:30';

  // Aktuell belegt?
  const { rows: current } = await pool.query(
    `SELECT id FROM bookings WHERE apartment_id=$1 AND start<=$2 AND "end">$2 LIMIT 1`,
    [apartmentId, nowIso]
  );

  if (current.length) {
    await pool.query(`UPDATE apartments SET status='belegt', checkout_time='09:30' WHERE id=$1`, [apartmentId]);
    return 'belegt';
  }

  // Letzter Checkout – erst nach Reinigungszeit gültig
  const today       = now.toISOString().substring(0, 10);
  const currentTime = now.toTimeString().substring(0, 5);

  const { rows: lastCO } = await pool.query(`
    SELECT "end" FROM bookings
    WHERE apartment_id=$1
    AND (
      LEFT("end",10) < $2
      OR (LEFT("end",10) = $2 AND $3 >= $4)
    )
    ORDER BY "end" DESC LIMIT 1
  `, [apartmentId, today, currentTime, checkoutTime]);

  if (!lastCO.length) {
    await pool.query(`UPDATE apartments SET status='sauber', last_checkout=NULL WHERE id=$1`, [apartmentId]);
    return 'sauber';
  }

  const { rows: lastClean } = await pool.query(
    `SELECT confirmed_at FROM cleanings WHERE apartment_id=$1 ORDER BY confirmed_at DESC LIMIT 1`,
    [apartmentId]
  );

  const cleaned = lastClean.length &&
    new Date(lastClean[0].confirmed_at) >= new Date(lastCO[0].end);

  const status = cleaned ? 'sauber' : 'muss_geputzt_werden';
  await pool.query(
    `UPDATE apartments SET status=$1, last_checkout=$2 WHERE id=$3`,
    [status, lastCO[0].end, apartmentId]
  );
  return status;
}

// Alle Apartments neu berechnen (z.B. beim Serverstart)
async function recomputeAll() {
  const { rows } = await pool.query(`SELECT id FROM apartments`);
  for (const apt of rows) {
    await recomputeStatus(apt.id).catch(err =>
      console.error(`recomputeStatus Fehler für Apartment ${apt.id}:`, err.message)
    );
  }
}

module.exports = { recomputeStatus, recomputeAll };
