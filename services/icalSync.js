const ical = require('node-ical');
const db = require('../db');

function recomputeStatus(apartmentId) {
  const now = new Date();
  const nowIso = now.toISOString();

  const currentBooking = db.prepare(
    `SELECT * FROM bookings WHERE apartment_id = ? AND start <= ? AND end > ? LIMIT 1`
  ).get(apartmentId, nowIso, nowIso);

  if (currentBooking) {
    db.prepare(`UPDATE apartments SET status = 'belegt' WHERE id = ?`).run(apartmentId);
    return 'belegt';
  }

  const lastCheckoutRow = db.prepare(
    `SELECT end FROM bookings WHERE apartment_id = ? AND end <= ? ORDER BY end DESC LIMIT 1`
  ).get(apartmentId, nowIso);

  if (!lastCheckoutRow) {
    db.prepare(`UPDATE apartments SET status = 'sauber', last_checkout = NULL WHERE id = ?`).run(apartmentId);
    return 'sauber';
  }

  const lastCheckout = lastCheckoutRow.end;
  const lastCleaning = db.prepare(
    `SELECT confirmed_at FROM cleanings WHERE apartment_id = ? ORDER BY confirmed_at DESC LIMIT 1`
  ).get(apartmentId);

  const wasCleanedAfterCheckout =
    lastCleaning && new Date(lastCleaning.confirmed_at) >= new Date(lastCheckout);

  const newStatus = wasCleanedAfterCheckout ? 'sauber' : 'muss_geputzt_werden';
  db.prepare(`UPDATE apartments SET status = ?, last_checkout = ? WHERE id = ?`).run(
    newStatus, lastCheckout, apartmentId
  );
  return newStatus;
}

async function syncApartment(apartment) {
  if (!apartment.ical_url) return;
  try {
    const data = await ical.async.fromURL(apartment.ical_url);
    const upsert = db.prepare(`
      INSERT INTO bookings (apartment_id, uid, start, end, summary, synced_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(apartment_id, uid) DO UPDATE SET
        start = excluded.start,
        end = excluded.end,
        summary = excluded.summary,
        synced_at = excluded.synced_at
    `);

    const events = Object.values(data)
      .filter(ev => ev.type === 'VEVENT' && ev.start && ev.end)
      .map(ev => ({
        apartment_id: apartment.id,
        uid: ev.uid || `${ev.start.toISOString()}-${ev.end.toISOString()}`,
        start: new Date(ev.start).toISOString(),
        end:   new Date(ev.end).toISOString(),
        summary: ev.summary || null,
      }));

    db.exec('BEGIN');
    try {
      for (const ev of events) {
        upsert.run(ev.apartment_id, ev.uid, ev.start, ev.end, ev.summary);
      }
      db.exec('COMMIT');
    } catch(e) {
      db.exec('ROLLBACK');
      throw e;
    }

    db.prepare(`UPDATE apartments SET last_sync_error = NULL WHERE id = ?`).run(apartment.id);
    recomputeStatus(apartment.id);
  } catch (err) {
    console.error(`iCal-Sync fehlgeschlagen für Apartment ${apartment.id}:`, err.message);
    db.prepare(`UPDATE apartments SET last_sync_error = ? WHERE id = ?`).run(err.message, apartment.id);
  }
}

async function syncAll() {
  const apartments = db.prepare(
    `SELECT * FROM apartments WHERE ical_url IS NOT NULL AND ical_url != ''`
  ).all();
  for (const apt of apartments) {
    await syncApartment(apt);
  }
}

module.exports = { syncApartment, syncAll, recomputeStatus };
