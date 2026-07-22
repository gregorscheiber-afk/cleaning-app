// iCal-Sync wurde entfernt – Buchungen werden über Excel importiert.
// Diese Datei enthält nur noch recomputeStatus (wird nach Excel-Import und Reinigungen benötigt).

const { pool } = require('../db');

async function recomputeStatus(apartmentId) {
  const now = new Date();
  const nowIso = now.toISOString();

  const { rows: aptRows } = await pool.query(
    `SELECT checkout_time FROM apartments WHERE id=$1`, [apartmentId]
  );
  // checkout_time (z.B. 09:30) ist nur die ANGEZEIGTE Reinigungszeit für die Putzdamen.
  // Der Status wechselt intern aber schon früh morgens um 02:00 Uhr auf "zu reinigen".
  const checkoutTime = '02:00';
  // Check-in-Zeit: ab wann eine neue Buchung als "belegt" gilt (Gast reist nachmittags an)
  const CHECKIN_TIME = '16:00';

  // Wiener Zeit bestimmen
  const viennaNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
  const today       = viennaNow.getFullYear() + '-' +
                      String(viennaNow.getMonth()+1).padStart(2,'0') + '-' +
                      String(viennaNow.getDate()).padStart(2,'0');
  const currentTime = String(viennaNow.getHours()).padStart(2,'0') + ':' +
                      String(viennaNow.getMinutes()).padStart(2,'0');

  // Gibt es heute einen Checkout der noch nicht gereinigt wurde? → hat VORRANG vor neuer Buchung
  const { rows: todayCheckout } = await pool.query(`
    SELECT "end" FROM bookings
    WHERE apartment_id=$1
    AND (
      LEFT("end",10) < $2
      OR (LEFT("end",10) = $2 AND $3 >= $4)
    )
    ORDER BY "end" DESC LIMIT 1
  `, [apartmentId, today, currentTime, checkoutTime]);

  if (todayCheckout.length) {
    // Prüfen ob nach diesem Checkout schon gereinigt wurde
    const { rows: lastClean } = await pool.query(
      `SELECT confirmed_at FROM cleanings WHERE apartment_id=$1 ORDER BY confirmed_at DESC LIMIT 1`,
      [apartmentId]
    );
    const cleaned = lastClean.length &&
      new Date(lastClean[0].confirmed_at) >= new Date(todayCheckout[0].end);

    if (!cleaned) {
      // Muss gereinigt werden – auch wenn heute schon ein neuer Gast anreist!
      await pool.query(
        `UPDATE apartments SET status='muss_geputzt_werden', last_checkout=$1, checkout_time='09:30' WHERE id=$2`,
        [todayCheckout[0].end, apartmentId]
      );
      return 'muss_geputzt_werden';
    }
  }

  // Aktuell belegt? (Buchung die heute startet erst ab Check-in-Zeit)
  const { rows: current } = await pool.query(`
    SELECT id, LEFT(start,10) as sd FROM bookings
    WHERE apartment_id=$1 AND start<=$2 AND "end">$2 LIMIT 1
  `, [apartmentId, nowIso]);

  if (current.length) {
    // Wenn die Buchung heute erst startet, ist sie erst ab Check-in-Zeit "belegt"
    const startsToday = current[0].sd === today;
    if (!startsToday || currentTime >= CHECKIN_TIME) {
      await pool.query(`UPDATE apartments SET status='belegt', checkout_time='09:30' WHERE id=$1`, [apartmentId]);
      return 'belegt';
    }
    // startet heute, aber vor Check-in-Zeit → gilt noch als sauber (bereit für Anreise)
    await pool.query(`UPDATE apartments SET status='sauber' WHERE id=$1`, [apartmentId]);
    return 'sauber';
  }

  // Keine laufende Buchung und Reinigung bestätigt (bzw. kein Checkout offen)
  // → sauber. Ohne diesen Fallback bliebe der Status nach der Reinigung
  // fälschlich auf "muss_geputzt_werden" stehen.
  await pool.query(`UPDATE apartments SET status='sauber' WHERE id=$1`, [apartmentId]);
  return 'sauber';
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
