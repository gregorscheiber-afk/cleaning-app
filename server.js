require('dotenv').config();
const express = require('express');
const path    = require('path');
const cron    = require('node-cron');

if (!process.env.DATABASE_URL) {
  console.error('FEHLER: DATABASE_URL ist nicht gesetzt!');
  process.exit(1);
}

const { initDb }        = require('./db');
const { recomputeAll }  = require('./services/icalSync');
const { sendCleaningAlert } = require('./services/cleaningAlert');
const housesRouter      = require('./routes/houses');
const apartmentsRouter  = require('./routes/apartments');
const cleaningsRouter   = require('./routes/cleanings');
const notesRouter       = require('./routes/notes');
const importRouter      = require('./routes/import');
const bookingsRouter    = require('./routes/bookings');
const planRouter        = require('./routes/plan');
const authRouter        = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/houses',     housesRouter);
app.use('/api/apartments', apartmentsRouter);
app.use('/api',            cleaningsRouter);
app.use('/api',            notesRouter);
app.use('/api',            importRouter);
app.use('/api',            bookingsRouter);
app.use('/api',            planRouter);
app.use('/api',            authRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/test-db', async (_req, res) => {
  try {
    const { pool } = require('./db');
    const { rows } = await pool.query('SELECT COUNT(*) as houses FROM houses');
    res.json({ db: 'ok', houses: rows[0].houses });
  } catch(e) {
    res.status(500).json({ db: 'error', error: e.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Fehler:', err.message);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
    // Status aller Apartments beim Start neu berechnen
    recomputeAll().catch(err => console.error('recomputeAll fehlgeschlagen:', err.message));
    // Stündlich Status neu berechnen (für automatischen Wechsel zur Reinigungszeit)
    cron.schedule('*/15 * * * *', () => {
      recomputeAll().catch(err => console.error('recomputeAll fehlgeschlagen:', err.message));
    });
  })
  .catch(err => {
    console.error('DB-Init fehlgeschlagen:', err.message || err.code || JSON.stringify(err));
    process.exit(1);
  });
