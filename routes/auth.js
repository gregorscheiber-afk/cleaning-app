const express = require('express');
const router  = express.Router();

// POST /api/auth  { pin, role }
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

  res.json({ ok: true, role });
});

module.exports = router;
