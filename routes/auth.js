const express = require('express');
const { setAdminCookie } = require('../services/auth');
const { pruefeTicket, einlassAbgelehnt, einlassWeiter } = require('../services/cockpit-einlass');
const router  = express.Router();

// GET /api/cockpit-einlass?ticket=…  – Einstieg aus dem MYALPS Ability Cockpit
router.get('/cockpit-einlass', (req, res) => {
  if (!pruefeTicket(req.query.ticket, 'putz')) return einlassAbgelehnt(res);
  setAdminCookie(req, res);
  einlassWeiter(res, '/admin.html?cockpit=1');
});

// POST /api/auth  { pin, role }
// Bei role "admin" wird zusätzlich ein HttpOnly-Cookie gesetzt, das die
// geschützten Admin-Endpunkte serverseitig freischaltet.
router.post('/auth', (req, res) => {
  const { pin, role } = req.body || {};
  if (!pin || !role) return res.status(400).json({ ok: false, error: 'Fehlende Daten' });

  const pins = {
    admin:   process.env.PIN_ADMIN   || '1234',
    planer:  process.env.PIN_PLANER  || '5678',
    cleaner: process.env.PIN_CLEANER || '9012',
  };

  if (!pins[role]) return res.status(400).json({ ok: false, error: 'Unbekannte Rolle' });
  if (pin !== pins[role]) return res.status(401).json({ ok: false, error: 'PIN falsch' });

  if (role === 'admin') setAdminCookie(req, res);
  res.json({ ok: true, role });
});

module.exports = router;
