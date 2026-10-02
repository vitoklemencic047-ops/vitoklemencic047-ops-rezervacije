import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Vrijeme se svugdje čuva kao lokalno vrijeme restorana:
// datum "YYYY-MM-DD", vrijeme u minutama od ponoći.

const globalForDb = globalThis as unknown as { db?: Database.Database };

function open(): Database.Database {
  const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "rezervacije.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- weekday: 0 = nedjelja ... 6 = subota; više redaka po danu = više smjena (npr. ručak i večera)
    CREATE TABLE IF NOT EXISTS opening_hours (
      id INTEGER PRIMARY KEY,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      open_min INTEGER NOT NULL,
      close_min INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS closed_dates (
      date TEXT PRIMARY KEY,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      min_seats INTEGER NOT NULL DEFAULT 1,
      max_seats INTEGER NOT NULL,
      online INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL,
      start_min INTEGER NOT NULL,
      duration_min INTEGER NOT NULL,
      party_size INTEGER NOT NULL,
      table_id INTEGER REFERENCES tables(id),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'online',
      status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
      reminder_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS reservations_date ON reservations(date);

    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Razgovori AI asistenta (chat na stranici, WhatsApp). messages = puna povijest za Claude API.
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      phone TEXT,
      messages TEXT NOT NULL DEFAULT '[]',
      user_turns INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS conversations_phone ON conversations(phone, updated_at);
  `);

  // Stupci dodani nakon prve verzije
  const cols = new Set((db.prepare("PRAGMA table_info(reservations)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("reminder2_sent")) db.exec("ALTER TABLE reservations ADD COLUMN reminder2_sent INTEGER NOT NULL DEFAULT 0");
  if (!cols.has("guest_confirmed_at")) db.exec("ALTER TABLE reservations ADD COLUMN guest_confirmed_at TEXT");

  const empty = db.prepare("SELECT COUNT(*) AS n FROM settings").get() as { n: number };
  if (empty.n === 0) seed(db);
}

function seed(db: Database.Database) {
  const setSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setSetting.run(k, String(v));

  const addHours = db.prepare("INSERT INTO opening_hours (weekday, open_min, close_min) VALUES (?, ?, ?)");
  // Utorak–nedjelja 12:00–23:00, ponedjeljak zatvoreno
  for (const d of [0, 2, 3, 4, 5, 6]) addHours.run(d, 12 * 60, 23 * 60);

  const addTable = db.prepare("INSERT INTO tables (name, min_seats, max_seats) VALUES (?, ?, ?)");
  [
    ["Stol 1", 1, 2], ["Stol 2", 1, 2], ["Stol 3", 2, 4], ["Stol 4", 2, 4],
    ["Stol 5", 2, 4], ["Stol 6", 4, 6], ["Stol 7", 4, 8], ["Terasa 1", 2, 4],
  ].forEach((t) => addTable.run(...t));
}

export const DEFAULT_SETTINGS = {
  restaurant_name: "Moj restoran",
  slot_interval: 15,      // razmak između ponuđenih termina (min)
  duration_small: 90,     // trajanje za 1–4 osobe (min)
  duration_large: 120,    // trajanje za 5+ osoba (min)
  buffer: 15,             // vrijeme za pospremanje stola (min)
  min_notice: 60,         // najkasnije koliko min unaprijed se može rezervirati online
  max_days_ahead: 60,     // koliko dana unaprijed je otvoreno za online rezervacije
  max_party_online: 8,    // veće grupe moraju nazvati
  phone: "+385 1 234 5678",
  timezone: "Europe/Zagreb",
  reminder1_hours: 24,          // prvi podsjetnik, sati prije dolaska (0 = isključeno)
  reminder2_hours: 2,           // drugi podsjetnik, sati prije dolaska (0 = isključeno)
  reminder_channels: "email,sms", // email, sms, whatsapp (odvojeno zarezom)
  country_code: "385",          // pozivni broj za brojeve upisane bez njega (091…)
};

export type Settings = typeof DEFAULT_SETTINGS;

export function db(): Database.Database {
  if (!globalForDb.db) globalForDb.db = open();
  return globalForDb.db;
}

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out: Record<string, string | number> = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    out[key] = typeof DEFAULT_SETTINGS[key as keyof Settings] === "number" ? Number(value) : value;
  }
  return out as Settings;
}

export function saveSettings(values: Partial<Record<keyof Settings, string | number>>) {
  const stmt = db().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [k, v] of Object.entries(values)) {
    if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, String(v));
  }
}
