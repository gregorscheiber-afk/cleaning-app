require('dotenv').config();
const express = require('express');
const path    = require('path');
const cron    = require('node-cron');

const { initDb }       = require('./db');
const housesRouter     = require('./routes/houses');
const apartmentsRouter = require('./routes/apartments');
const cleaningsRouter  = require('./routes/cleanings');
const notesRouter      = require('./routes/notes');
const importRouter     = require('./routes/import');
const { syncAll }      = require('./services/icalSync');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/houses',     housesRouter);
app.use('/api/apartments', apartmentsRouter);
app.use('/api',            cleaningsRouter);
app.use('/api',            notesRouter);
app.use('/api',            importRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error('Fehler:', err.message);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
    syncAll().catch(err => console.error('Initialer Sync fehlgeschlagen:', err.message));
    cron.schedule(process.env.SYNC_CRON || '*/15 * * * *', () => {
      syncAll().catch(err => console.error('Sync fehlgeschlagen:', err.message));
    });
  })
  .catch(err => {
    console.error('DB-Init fehlgeschlagen:', err.message);
    process.exit(1);
  });
