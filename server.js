require('dotenv').config();
const express = require('express');
const path    = require('path');
const cron    = require('node-cron');

const housesRouter     = require('./routes/houses');
const apartmentsRouter = require('./routes/apartments');
const cleaningsRouter  = require('./routes/cleanings');
const notesRouter      = require('./routes/notes');
const { syncAll }      = require('./services/icalSync');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/houses',     housesRouter);
app.use('/api/apartments', apartmentsRouter);
app.use('/api',            cleaningsRouter);
app.use('/api',            notesRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));

// Globaler Fehlerhandler – gibt immer JSON zurück, nie leere Antwort
app.use((err, _req, res, _next) => {
  console.error('Unbehandelter Fehler:', err);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});

syncAll().catch(err => console.error('Initialer Sync fehlgeschlagen:', err));
cron.schedule(process.env.SYNC_CRON || '*/15 * * * *', () => {
  syncAll().catch(err => console.error('Sync fehlgeschlagen:', err));
});
