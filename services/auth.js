const crypto = require('crypto');

// Serverseitiger Schutz für die Admin-API.
// Der PIN-Bildschirm (public/auth.js) ist nur die Oberfläche – erst das
// HttpOnly-Cookie, das /api/auth bei korrektem Admin-PIN setzt, gibt die
// geschützten Endpunkte frei.

const COOKIE_NAME = 'ma_admin';
const MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000; // 30 Tage angemeldet bleiben

function secret() {
  return process.env.SESSION_SECRET || process.env.PIN_ADMIN || 'myalps-dev-secret';
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function createToken() {
  const expires = Date.now() + MAX_AGE_MS;
  return `${expires}.${sign(String(expires))}`;
}

function verifyToken(token) {
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig) return false;
  if (Number(expires) < Date.now()) return false;
  const expected = sign(expires);
  return sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAdmin(req) {
  return verifyToken(getCookie(req, COOKIE_NAME));
}

function setAdminCookie(req, res) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${createToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}${isSecure ? '; Secure' : ''}`);
}

// Middleware: nur für angemeldete Admins
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Nicht angemeldet' });
}

module.exports = { isAdmin, setAdminCookie, requireAdmin };
