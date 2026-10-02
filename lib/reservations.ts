import crypto from "node:crypto";
import { db, getSettings, type Settings } from "./db";
import { addDays, nowIn, weekday } from "./time";

export type Table = {
  id: number; name: string; min_seats: number; max_seats: number; online: number; active: number;
};

export type Reservation = {
  id: number; token: string; date: string; start_min: number; duration_min: number;
  party_size: number; table_id: number | null; name: string; email: string | null;
  phone: string | null; note: string | null; source: string; status: Status;
  reminder_sent: number; created_at: string;
};

export type Status = "confirmed" | "seated" | "completed" | "cancelled" | "no_show";
export const ACTIVE_STATUSES: Status[] = ["confirmed", "seated"];

export class BookingError extends Error {}

export function durationFor(party: number, s: Settings): number {
  return party <= 4 ? s.duration_small : s.duration_large;
}

type Mode = { online: boolean };

function shifts(date: string): { open_min: number; close_min: number }[] {
  const closed = db().prepare("SELECT 1 FROM closed_dates WHERE date = ?").get(date);
  if (closed) return [];
  return db()
    .prepare("SELECT open_min, close_min FROM opening_hours WHERE weekday = ? ORDER BY open_min")
    .all(weekday(date)) as { open_min: number; close_min: number }[];
}

function candidateTables(party: number, mode: Mode): Table[] {
  return db()
    .prepare(
      `SELECT * FROM tables WHERE active = 1 AND min_seats <= ? AND max_seats >= ? ${mode.online ? "AND online = 1" : ""}
       ORDER BY max_seats, id`,
    )
    .all(party, party) as Table[];
}

function busyByTable(date: string): Map<number, { start: number; end: number }[]> {
  const rows = db()
    .prepare(
      `SELECT table_id, start_min, duration_min FROM reservations
       WHERE date = ? AND table_id IS NOT NULL AND status IN ('confirmed', 'seated')`,
    )
    .all(date) as { table_id: number; start_min: number; duration_min: number }[];
  const map = new Map<number, { start: number; end: number }[]>();
  for (const r of rows) {
    const list = map.get(r.table_id) ?? [];
    list.push({ start: r.start_min, end: r.start_min + r.duration_min });
    map.set(r.table_id, list);
  }
  return map;
}

function isFree(busy: { start: number; end: number }[] | undefined, start: number, end: number, buffer: number) {
  return !(busy ?? []).some((b) => start < b.end + buffer && b.start < end + buffer);
}

// Termini u kojima postoji barem jedan slobodan stol; uz svaki termin i najbolji stol (najmanji koji odgovara).
export function availableSlots(date: string, party: number, mode: Mode): { start_min: number; table_id: number }[] {
  const s = getSettings();
  if (party < 1) return [];
  if (mode.online) {
    if (party > s.max_party_online) return [];
    const now = nowIn(s.timezone);
    if (date < now.date || date > addDays(now.date, s.max_days_ahead)) return [];
  }
  const now = nowIn(s.timezone);
  const duration = durationFor(party, s);
  const tables = candidateTables(party, mode);
  const busy = busyByTable(date);
  const slots: { start_min: number; table_id: number }[] = [];

  for (const shift of shifts(date)) {
    for (let t = shift.open_min; t + duration <= shift.close_min; t += s.slot_interval) {
      if (mode.online && date === now.date && t < now.min + s.min_notice) continue;
      const table = tables.find((tb) => isFree(busy.get(tb.id), t, t + duration, s.buffer));
      if (table) slots.push({ start_min: t, table_id: table.id });
    }
  }
  return slots;
}

export type NewReservation = {
  date: string; start_min: number; party_size: number; name: string;
  email?: string | null; phone?: string | null; note?: string | null;
  table_id?: number | null; duration_min?: number;
};

// Provjera i upis su u istoj sinkronoj transakciji, pa dvije istovremene rezervacije ne mogu dobiti isti stol.
export function createReservation(input: NewReservation, mode: Mode & { source: string }): Reservation {
  const tx = db().transaction(() => {
    const s = getSettings();
    let tableId: number | null;
    let duration = input.duration_min ?? durationFor(input.party_size, s);

    if (input.email) {
      const dup = db()
        .prepare(
          `SELECT 1 FROM reservations WHERE date = ? AND start_min = ? AND lower(email) = lower(?)
           AND status IN ('confirmed', 'seated')`,
        )
        .get(input.date, input.start_min, input.email);
      if (dup) throw new BookingError("Već imate rezervaciju u to vrijeme.");
    }

    if (input.table_id != null) {
      if (mode.online) throw new BookingError("Odabir stola nije dopušten.");
      const busy = busyByTable(input.date).get(input.table_id);
      if (!isFree(busy, input.start_min, input.start_min + duration, s.buffer)) {
        throw new BookingError("Taj stol je zauzet u odabrano vrijeme.");
      }
      tableId = input.table_id;
    } else {
      const slot = availableSlots(input.date, input.party_size, mode).find((x) => x.start_min === input.start_min);
      if (!slot) throw new BookingError("Nažalost, taj termin više nije slobodan. Odaberite drugi.");
      tableId = slot.table_id;
      duration = durationFor(input.party_size, s);
    }

    const token = crypto.randomBytes(16).toString("base64url");
    const info = db()
      .prepare(
        `INSERT INTO reservations (token, date, start_min, duration_min, party_size, table_id, name, email, phone, note, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token, input.date, input.start_min, duration, input.party_size, tableId,
        input.name, input.email || null, input.phone || null, input.note || null, mode.source,
      );
    return getReservation(Number(info.lastInsertRowid))!;
  });
  return tx.immediate();
}

export function getReservation(id: number): Reservation | undefined {
  return db().prepare("SELECT * FROM reservations WHERE id = ?").get(id) as Reservation | undefined;
}

export function getByToken(token: string): Reservation | undefined {
  return db().prepare("SELECT * FROM reservations WHERE token = ?").get(token) as Reservation | undefined;
}

export function setStatus(id: number, status: Status) {
  db().prepare("UPDATE reservations SET status = ? WHERE id = ?").run(status, id);
}

export function listForDate(date: string): (Reservation & { table_name: string | null })[] {
  return db()
    .prepare(
      `SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN tables t ON t.id = r.table_id
       WHERE r.date = ? ORDER BY r.start_min, r.id`,
    )
    .all(date) as (Reservation & { table_name: string | null })[];
}

export function listTables(): Table[] {
  return db().prepare("SELECT * FROM tables ORDER BY id").all() as Table[];
}

export function addToWaitlist(w: { date: string; party_size: number; name: string; email?: string; phone?: string }) {
  db()
    .prepare("INSERT INTO waitlist (date, party_size, name, email, phone) VALUES (?, ?, ?, ?, ?)")
    .run(w.date, w.party_size, w.name, w.email || null, w.phone || null);
}

// Gosti s liste čekanja za koje se nakon otkazivanja pojavio slobodan termin
export function waitlistMatches(date: string) {
  const rows = db()
    .prepare("SELECT * FROM waitlist WHERE date = ? AND notified = 0 ORDER BY created_at")
    .all(date) as { id: number; party_size: number; name: string; email: string | null; phone: string | null }[];
  return rows.filter((w) => availableSlots(date, w.party_size, { online: true }).length > 0);
}

export function markWaitlistNotified(id: number) {
  db().prepare("UPDATE waitlist SET notified = 1 WHERE id = ?").run(id);
}

// Potvrđene rezervacije koje počinju u sljedećih `hours` sati, a podsjetnik još nije poslan
export function dueReminders(hours: number): Reservation[] {
  const s = getSettings();
  const now = nowIn(s.timezone);
  const nowAbs = Date.parse(now.date + "T00:00:00Z") / 60000 + now.min;
  const rows = db()
    .prepare(
      `SELECT * FROM reservations WHERE status = 'confirmed' AND reminder_sent = 0 AND email IS NOT NULL
       AND date BETWEEN ? AND ?`,
    )
    .all(now.date, addDays(now.date, Math.ceil(hours / 24) + 1)) as Reservation[];
  return rows.filter((r) => {
    const abs = Date.parse(r.date + "T00:00:00Z") / 60000 + r.start_min;
    return abs > nowAbs && abs - nowAbs <= hours * 60;
  });
}

export function markReminderSent(id: number) {
  db().prepare("UPDATE reservations SET reminder_sent = 1 WHERE id = ?").run(id);
}
