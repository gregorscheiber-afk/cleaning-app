const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS houses (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      address    TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS apartments (
      id              SERIAL PRIMARY KEY,
      house_id        INTEGER REFERENCES houses(id) ON DELETE SET NULL,
      name            TEXT NOT NULL,
      ical_url        TEXT,
      pms_code        TEXT,
      checkout_time   TEXT DEFAULT '09:30',
      status          TEXT NOT NULL DEFAULT 'sauber',
      last_checkout   TEXT,
      last_sync_error TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS apartment_notes (
      id           SERIAL PRIMARY KEY,
      apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      message      TEXT NOT NULL,
      note_type    TEXT DEFAULT 'team',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id           SERIAL PRIMARY KEY,
      apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      uid          TEXT,
      start        TEXT NOT NULL,
      "end"        TEXT NOT NULL,
      summary      TEXT,
      persons      TEXT,
      synced_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(apartment_id, uid)
    );

    CREATE TABLE IF NOT EXISTS cleanings (
      id           SERIAL PRIMARY KEY,
      apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      cleaner_name TEXT NOT NULL,
      confirmed_at TIMESTAMPTZ DEFAULT NOW(),
      note         TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id           SERIAL PRIMARY KEY,
      apartment_id INTEGER NOT NULL,
      message      TEXT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      read         INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Zusatzleistungen pro Buchung (z. B. Frühstück/Zwischenreinigung für José).
    -- Bewusst NICHT in bookings: der Excel-Import ersetzt Buchungen komplett,
    -- diese Tabelle bleibt bestehen. Anker = Apartment + Anreisedatum.
    CREATE TABLE IF NOT EXISTS booking_services (
      id            SERIAL PRIMARY KEY,
      apartment_id  INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      start         TEXT NOT NULL,
      breakfast     TEXT,
      interim_clean TEXT,
      UNIQUE(apartment_id, start)
    );

    -- Tages-Einteilung: welche Apartments sollen an welchem Tag geputzt werden.
    -- Anker = Apartment + Datum (überlebt so den Excel-Import). Die Auswahl
    -- ist unabhängig vom Belegt-Status – man kann also 2-3 Tage im Voraus
    -- einteilen, auch wenn gerade noch ein Gast da ist.
    CREATE TABLE IF NOT EXISTS cleaning_assignments (
      id           SERIAL PRIMARY KEY,
      apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      date         TEXT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(apartment_id, date)
    );
  `);

  await pool.query(`ALTER TABLE apartments ADD COLUMN IF NOT EXISTS pms_code     TEXT`);
  await pool.query(`ALTER TABLE apartments ADD COLUMN IF NOT EXISTS checkout_time TEXT DEFAULT '09:30'`);
  await pool.query(`ALTER TABLE bookings   ADD COLUMN IF NOT EXISTS persons           TEXT`);
  await pool.query(`ALTER TABLE apartment_notes ADD COLUMN IF NOT EXISTS note_type    TEXT DEFAULT 'team'`);
  await pool.query(`ALTER TABLE bookings   ADD COLUMN IF NOT EXISTS source            TEXT DEFAULT 'ical'`);
  await pool.query(`ALTER TABLE bookings   ADD COLUMN IF NOT EXISTS guest_name        TEXT`);
  await pool.query(`ALTER TABLE bookings   ADD COLUMN IF NOT EXISTS highlighted_until TEXT`);

  console.log('Datenbank bereit.');
}

module.exports = { pool, initDb };
