import crypto from "node:crypto";
import { db, getSettings, type Settings } from "./db";
import { busyByTable, findSeat, isFree, seatingContext, setTables } from "./seating";
import { addDays, nowIn, weekday } from "./time";

export type Table = {
  id: number; name: string; min_seats: number; max_seats: number; online: number; active: number;
  x: number | null; y: number | null; w: number; h: number; rot: number;
  shape: "rect" | "round"; zone: string; combinable: number;
};

export type Reservation = {
  id: number; token: string; date: string; start_min: number; duration_min: number;
  party_size: number; table_id: number | null; name: string; email: string | null;
  phone: string | null; note: string | null; source: string; status: Status;
  reminder_sent: number; reminder2_sent: number; guest_confirmed_at: string | null; created_at: string;
  external_source: string | null; external_id: string | null; table_locked: number;
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

// Termini u kojima ima mjesta za grupu; uz svaki termin i najbolji stol (ili spojeni stolovi).
export function availableSlots(date: string, party: number, mode: Mode): { start_min: number; table_ids: number[] }[] {
  const s = getSettings();
  if (party < 1) return [];
  if (mode.online) {
    if (party > s.max_party_online) return [];
    const now = nowIn(s.timezone);
    if (date < now.date || date > addDays(now.date, s.max_days_ahead)) return [];
  }
  const now = nowIn(s.timezone);
  const duration = durationFor(party, s);
  const ctx = seatingContext(mode);
  const busy = busyByTable(date);
  const slots: { start_min: number; table_ids: number[] }[] = [];

  for (const shift of shifts(date)) {
    for (let t = shift.open_min; t + duration <= shift.close_min; t += s.slot_interval) {
      if (mode.online && date === now.date && t < now.min + s.min_notice) continue;
      const seat = findSeat(ctx, busy, party, t, t + duration, s);
      if (seat) slots.push({ start_min: t, table_ids: seat.map((tb) => tb.id) });
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
    let tableIds: number[];
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
      tableIds = [input.table_id];
    } else {
      const slot = availableSlots(input.date, input.party_size, mode).find((x) => x.start_min === input.start_min);
      if (!slot) throw new BookingError("Nažalost, taj termin više nije slobodan. Odaberite drugi.");
      tableIds = slot.table_ids;
      duration = durationFor(input.party_size, s);
    }

    const token = crypto.randomBytes(16).toString("base64url");
    const info = db()
      .prepare(
        `INSERT INTO reservations (token, date, start_min, duration_min, party_size, table_id, name, email, phone, note, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token, input.date, input.start_min, duration, input.party_size, null,
        input.name, input.email || null, input.phone || null, input.note || null, mode.source,
      );
    const id = Number(info.lastInsertRowid);
    setTables(id, tableIds, input.table_id != null);
    // Podsjetnik čiji je trenutak već prošao (rezervacija u zadnji čas) se ne šalje
    const until = minutesUntil(input, s.timezone);
    markReminders(id, until <= s.reminder1_hours * 60, until <= s.reminder2_hours * 60);
    return getReservation(id)!;
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

export type DayReservation = Reservation & { table_name: string | null; table_ids: number[] };

// table_name je npr. "Stol 3 + Stol 4" kad je grupa za spojenim stolovima
export function listForDate(date: string): DayReservation[] {
  const rows = db()
    .prepare(
      `SELECT r.*, (SELECT group_concat(table_id) FROM reservation_tables WHERE reservation_id = r.id) AS extra
       FROM reservations r WHERE r.date = ? ORDER BY r.start_min, r.id`,
    )
    .all(date) as (Reservation & { extra: string | null })[];
  const names = new Map(listTables().map((t) => [t.id, t.name]));
  return rows.map(({ extra, ...r }) => {
    const ids = r.table_id ? [r.table_id, ...(extra ? extra.split(",").map(Number) : [])] : [];
    return { ...r, table_ids: ids, table_name: ids.length ? ids.map((i) => names.get(i) ?? `#${i}`).join(" + ") : null };
  });
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

// Minute od sada do početka rezervacije (u vremenu restorana)
export function minutesUntil(r: { date: string; start_min: number }, timeZone: string): number {
  const now = nowIn(timeZone);
  const abs = (date: string, min: number) => Date.parse(date + "T00:00:00Z") / 60000 + min;
  return abs(r.date, r.start_min) - abs(now.date, now.min);
}

// Potvrđene buduće rezervacije kojima još nije poslan neki od podsjetnika
export function pendingReminders(): Reservation[] {
  const s = getSettings();
  const today = nowIn(s.timezone).date;
  const horizon = Math.ceil(Math.max(s.reminder1_hours, s.reminder2_hours) / 24) + 1;
  return db()
    .prepare(
      `SELECT * FROM reservations WHERE status = 'confirmed' AND (reminder_sent = 0 OR reminder2_sent = 0)
       AND date BETWEEN ? AND ?`,
    )
    .all(today, addDays(today, horizon)) as Reservation[];
}

export function markReminders(id: number, first: boolean, second: boolean) {
  db()
    .prepare("UPDATE reservations SET reminder_sent = MAX(reminder_sent, ?), reminder2_sent = MAX(reminder2_sent, ?) WHERE id = ?")
    .run(first ? 1 : 0, second ? 1 : 0, id);
}

export function confirmAttendance(id: number) {
  db().prepare("UPDATE reservations SET guest_confirmed_at = datetime('now') WHERE id = ? AND guest_confirmed_at IS NULL").run(id);
}
