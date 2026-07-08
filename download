const ical = require('node-ical');
const db   = require('../db');

function recomputeStatus(apartmentId) {
  const nowIso = new Date().toISOString();

  const currentBooking = db.prepare(
    `SELECT id FROM bookings WHERE apartment_id=? AND start<=? AND end>? LIMIT 1`
  ).get(apartmentId, nowIso, nowIso);

  if (currentBooking) {
    db.prepare(`UPDATE apartments SET status='belegt' WHERE id=?`).run(apartmentId);
    return 'belegt';
  }

  const lastCheckoutRow = db.prepare(
    `SELECT end FROM bookings WHERE apartment_id=? AND end<=? ORDER BY end DESC LIMIT 1`
  ).get(apartmentId, nowIso);

  if (!lastCheckoutRow) {
    db.prepare(`UPDATE apartments SET status='sauber', last_checkout=NULL WHERE id=?`).run(apartmentId);
    return 'sauber';
  }

  const lastCleaning = db.prepare(
    `SELECT confirmed_at FROM cleanings WHERE apartment_id=? ORDER BY confirmed_at DESC LIMIT 1`
  ).get(apartmentId);

  const cleaned = lastCleaning &&
    new Date(lastCleaning.confirmed_at) >= new Date(lastCheckoutRow.end);

  const status = cleaned ? 'sauber' : 'muss_geputzt_werden';
  db.prepare(`UPDATE apartments SET status=?, last_checkout=? WHERE id=?`)
    .run(status, lastCheckoutRow.end, apartmentId);
  return status;
}

async function syncApartment(apartment) {
  if (!apartment.ical_url) return;
  try {
    const data = await ical.async.fromURL(apartment.ical_url);

    const seen = new Set();
    const events = Object.values(data)
      .filter(ev => ev.type === 'VEVENT' && ev.start && ev.end)
      .map(ev => ({
        apartment_id: apartment.id,
        uid:     ev.uid || `${new Date(ev.start).toISOString()}|${new Date(ev.end).toISOString()}`,
        start:   new Date(ev.start).toISOString(),
        end:     new Date(ev.end).toISOString(),
        summary: ev.summary || null,
      }))
      .filter(ev => {
        const key = `${ev.start}|${ev.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const sync = db.transaction((evList) => {
      db.prepare(`DELETE FROM bookings WHERE apartment_id=?`).run(apartment.id);
      const ins = db.prepare(
        `INSERT INTO bookings (apartment_id,uid,start,end,summary,synced_at)
         VALUES (@apartment_id,@uid,@start,@end,@summary,datetime('now'))`
      );
      for (const ev of evList) ins.run(ev);
    });

    sync(events);
    db.prepare(`UPDATE apartments SET last_sync_error=NULL WHERE id=?`).run(apartment.id);
    recomputeStatus(apartment.id);
  } catch (err) {
    console.error(`Sync-Fehler Apartment ${apartment.id}:`, err.message);
    db.prepare(`UPDATE apartments SET last_sync_error=? WHERE id=?`).run(err.message, apartment.id);
  }
}

async function syncAll() {
  const apts = db.prepare(
    `SELECT * FROM apartments WHERE ical_url IS NOT NULL AND ical_url!=''`
  ).all();
  for (const apt of apts) await syncApartment(apt);
}

module.exports = { syncApartment, syncAll, recomputeStatus };
