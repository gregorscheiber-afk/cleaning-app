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
