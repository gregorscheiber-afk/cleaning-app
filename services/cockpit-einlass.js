// Einstieg aus dem MYALPS Ability Cockpit, ohne zweite Anmeldung.
// Das Cockpit stellt eine Einstiegskarte aus: nur für diese App, eine Minute
// gültig, nur einmal verwendbar. Ohne COCKPIT_SCHLUESSEL ist der Einstieg aus.
const crypto = require('crypto');

const GUELTIG_MS = 60 * 1000;
const UHR_TOLERANZ_MS = 5 * 1000;
const benutzt = new Map();

function pruefeTicket(ticket, appId) {
  const schluessel = process.env.COCKPIT_SCHLUESSEL;
  if (!schluessel || schluessel.length < 32 || typeof ticket !== 'string') return false;

  const teile = ticket.split('.');
  if (teile.length !== 4) return false;
  const [id, ablauf, zufall, signatur] = teile;
  if (id !== appId) return false;

  const jetzt = Date.now();
  const ablaufMs = Number(ablauf);
  if (!Number.isInteger(ablaufMs) || ablaufMs < jetzt || ablaufMs > jetzt + GUELTIG_MS + UHR_TOLERANZ_MS) return false;

  const erwartet = crypto.createHmac('sha256', schluessel).update(`${id}.${ablauf}.${zufall}`).digest('hex');
  const a = Buffer.from(signatur);
  const b = Buffer.from(erwartet);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  for (const [wert, bis] of benutzt) if (bis < jetzt) benutzt.delete(wert);
  if (benutzt.has(zufall)) return false;
  benutzt.set(zufall, ablaufMs);
  return true;
}

// Abfrage der Hinweise durch das Cockpit: eigene Karte, taugt nicht zum Einstieg
function statusErlaubt(req, appId) {
  const kopf = req.headers.authorization || '';
  return kopf.startsWith('Bearer ') && pruefeTicket(kopf.slice(7), `${appId}-status`);
}

function einlassAbgelehnt(res) {
  res.status(403).set('Cache-Control', 'no-store').type('text/plain; charset=utf-8')
    .send('Dieser Einstieg ist abgelaufen. Bitte im MYALPS Ability Cockpit noch einmal auf die Kachel klicken.');
}

function einlassWeiter(res, ziel) {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).redirect(ziel);
}

module.exports = { pruefeTicket, statusErlaubt, einlassAbgelehnt, einlassWeiter };
