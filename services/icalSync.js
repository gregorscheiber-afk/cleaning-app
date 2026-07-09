const ical = require('node-ical');
const { pool } = require('../db');

async function recomputeStatus(apartmentId) {
  const now = new Date();
  const nowIso = now.toISOString();

  const { rows: aptRows } = await pool.query(
    `SELECT checkout_time FROM apartments WHERE id=$1`, [apartmentId]
  );
  const checkoutTime = aptRows[0]?.checkout_time || '09:30';

  const { rows: current } = await pool.query(
    `SELECT id FROM bookings WHERE apartment_id=$1 AND start<=$2 AND "end">$2 LIMIT 1`,
    [apartmentId, nowIso]
  );

  if (current.length) {
    await pool.query(`UPDATE apartments SET status='belegt', checkout_time='09:30' WHERE id=$1`, [apartmentId]);
    return 'belegt';
  }

  const today       = now.toISOString().substring(0, 10);
  const currentTime = now.toTimeString().substring(0, 5);

  const { rows: lastCO } = await pool.query(`
    SELECT "end" FROM bookings
    WHERE apartment_id = $1
    AND (
      LEFT("end", 10) < $2
      OR (LEFT("end", 10) = $2 AND $3 >= $4)
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

async function syncApartment(apartment) {
  if (!apartment.ical_url) return;
  const client = await pool.connect();
  try {
    const data = await ical.async.fromURL(apartment.ical_url);
    const nowIso = new Date().toISOString();

    // Nächste Buchung VOR dem Sync merken
    const { rows: prevNext } = await pool.query(
      `SELECT LEFT(start,10) as startdate FROM bookings
       WHERE apartment_id=$1 AND start>$2
       ORDER BY start ASC LIMIT 1`,
      [apartment.id, nowIso]
    );
    const prevNextDate = prevNext[0]?.startdate || null;

    // Personenangaben + Highlights vor dem Sync retten
    const { rows: existing } = await pool.query(
      `SELECT LEFT(start,10) as date, persons, highlighted_until
       FROM bookings WHERE apartment_id=$1 AND (source='ical' OR source IS NULL)`,
      [apartment.id]
    );
    const backup = {};
    existing.forEach(b => { backup[b.date] = { persons: b.persons, highlighted_until: b.highlighted_until }; });

    // Duplikate filtern
    const seen = new Set();
    const events = Object.values(data)
      .filter(ev => ev.type === 'VEVENT' && ev.start && ev.end)
      .map(ev => ({
        uid:   ev.uid || `${new Date(ev.start).toISOString()}|${new Date(ev.end).toISOString()}`,
        start: new Date(ev.start).toISOString(),
        end:   new Date(ev.end).toISOString(),
        summary: ev.summary || null,
      }))
      .filter(ev => {
        const key = `${ev.start}|${ev.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // Nächste Buchung NACH dem Sync bestimmen (aus neuen Events)
    const futureEvents = events
      .filter(ev => ev.start > nowIso)
      .sort((a, b) => a.start.localeCompare(b.start));
    const newNextDate = futureEvents[0]
      ? futureEvents[0].start.substring(0, 10)
      : null;

    // Ist eine neue frühere Buchung dabei?
    const hasNewEarlier = newNextDate && (
      !prevNextDate || newNextDate < prevNextDate
    );

    await client.query('BEGIN');
    await client.query(`DELETE FROM bookings WHERE apartment_id=$1 AND (source='ical' OR source IS NULL)`, [apartment.id]);
    for (const ev of events) {
      await client.query(
        `INSERT INTO bookings (apartment_id,uid,start,"end",summary) VALUES ($1,$2,$3,$4,$5)`,
        [apartment.id, ev.uid, ev.start, ev.end, ev.summary]
      );
    }
    await client.query('COMMIT');

    // Persons + Highlights wiederherstellen
    for (const [date, saved] of Object.entries(backup)) {
      if (saved.persons || saved.highlighted_until) {
        await pool.query(
          `UPDATE bookings SET persons=$1, highlighted_until=$2
           WHERE apartment_id=$3 AND LEFT(start,10)=$4`,
          [saved.persons || null, saved.highlighted_until || null, apartment.id, date]
        );
      }
    }

    // Neue frühere Buchung highlighten bis Anreisetag 19:00 Uhr
    if (hasNewEarlier && newNextDate) {
      const highlightedUntil = `${newNextDate}T19:00:00`;
      await pool.query(
        `UPDATE bookings SET highlighted_until=$1
         WHERE apartment_id=$2 AND LEFT(start,10)=$3`,
        [highlightedUntil, apartment.id, newNextDate]
      );
    }

    await pool.query(`UPDATE apartments SET last_sync_error=NULL WHERE id=$1`, [apartment.id]);
    await recomputeStatus(apartment.id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`Sync-Fehler Apartment ${apartment.id}:`, err.message);
    await pool.query(`UPDATE apartments SET last_sync_error=$1 WHERE id=$2`, [err.message, apartment.id]);
  } finally {
    client.release();
  }
}

async function syncAll() {
  const { rows } = await pool.query(
    `SELECT * FROM apartments WHERE ical_url IS NOT NULL AND ical_url!=''`
  );
  for (const apt of rows) await syncApartment(apt);
}

module.exports = { syncApartment, syncAll, recomputeStatus };
