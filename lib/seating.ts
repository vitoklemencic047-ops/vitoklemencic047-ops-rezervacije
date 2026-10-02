import { db, getSettings, type Settings } from "./db";
import { adjacent } from "./geometry";
import type { Table } from "./reservations";

// Automatski raspored gostiju po stolovima.
// Prvo se traži jedan slobodan stol s najmanje praznih mjesta; ako ga nema, spajaju se susjedni
// stolovi s tlocrta (do MAX_JOIN komada) tako da ostane što manje praznih mjesta.

const MAX_JOIN = 4;

export type Interval = { start: number; end: number };
export type Busy = Map<number, Interval[]>;

export function isFree(busy: Interval[] | undefined, start: number, end: number, buffer: number) {
  return !(busy ?? []).some((b) => start < b.end + buffer && b.start < end + buffer);
}

// Zauzeće svih stolova za dan (glavni stol + spojeni stolovi), bez rezervacija iz `except`
export function busyByTable(date: string, except: number[] = []): Busy {
  const skip = new Set(except);
  const rows = db()
    .prepare(
      `SELECT r.id, r.table_id, r.start_min, r.duration_min FROM reservations r
       WHERE r.date = ? AND r.table_id IS NOT NULL AND r.status IN ('confirmed', 'seated')
       UNION ALL
       SELECT r.id, rt.table_id, r.start_min, r.duration_min FROM reservation_tables rt
       JOIN reservations r ON r.id = rt.reservation_id
       WHERE r.date = ? AND r.status IN ('confirmed', 'seated')`,
    )
    .all(date, date) as { id: number; table_id: number; start_min: number; duration_min: number }[];
  const map: Busy = new Map();
  for (const r of rows) {
    if (skip.has(r.id)) continue;
    const list = map.get(r.table_id) ?? [];
    list.push({ start: r.start_min, end: r.start_min + r.duration_min });
    map.set(r.table_id, list);
  }
  return map;
}

export type Seating = { tables: Table[]; online: boolean };

export function seatingContext(mode: { online: boolean }): Seating {
  const tables = db()
    .prepare(`SELECT * FROM tables WHERE active = 1 ${mode.online ? "AND online = 1" : ""} ORDER BY max_seats, id`)
    .all() as Table[];
  return { tables, online: mode.online };
}

// Svi povezani skupovi od 2..MAX_JOIN susjednih stolova koji se smiju spajati
function combos(tables: Table[], s: Settings): Table[][] {
  const joinable = tables.filter((t) => t.combinable && t.x != null);
  const nb = new Map<number, Table[]>(joinable.map((t) => [t.id, joinable.filter((o) => o.id !== t.id && adjacent(t, o, s.join_distance))]));
  const seen = new Set<string>();
  const out: Table[][] = [];
  const grow = (set: Table[]) => {
    const key = set.map((t) => t.id).sort((a, b) => a - b).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    if (set.length > 1) out.push(set);
    if (set.length >= MAX_JOIN) return;
    for (const t of set) for (const n of nb.get(t.id) ?? []) if (!set.includes(n)) grow([...set, n]);
  };
  for (const t of joinable) grow([t]);
  return out;
}

const comboCache = new WeakMap<Seating, Table[][]>();

// Najbolji slobodan stol ili skup spojenih stolova; null ako grupa ne stane
export function findSeat(ctx: Seating, busy: Busy, party: number, start: number, end: number, s: Settings): Table[] | null {
  const free = (t: Table) => isFree(busy.get(t.id), start, end, s.buffer);
  const single = ctx.tables.find((t) => t.min_seats <= party && t.max_seats >= party && free(t));
  if (single) return [single];
  if (!Number(s.combine_tables)) return null;

  let all = comboCache.get(ctx);
  if (!all) comboCache.set(ctx, (all = combos(ctx.tables, s)));
  let best: Table[] | null = null;
  let bestSeats = Infinity;
  for (const set of all) {
    const seats = set.reduce((n, t) => n + t.max_seats, 0);
    if (seats < party) continue;
    if (seats > bestSeats || (seats === bestSeats && best && set.length >= best.length)) continue;
    if (!set.every(free)) continue;
    best = set;
    bestSeats = seats;
  }
  return best;
}

export function reserve(busy: Busy, tables: Table[], start: number, end: number) {
  for (const t of tables) {
    const list = busy.get(t.id) ?? [];
    list.push({ start, end });
    busy.set(t.id, list);
  }
}

// Upisuje stolove rezervacije: prvi je glavni (reservations.table_id), ostali idu u reservation_tables
export function setTables(reservationId: number, tableIds: number[], locked: boolean) {
  db().prepare("DELETE FROM reservation_tables WHERE reservation_id = ?").run(reservationId);
  db().prepare("UPDATE reservations SET table_id = ?, table_locked = ? WHERE id = ?")
    .run(tableIds[0] ?? null, locked ? 1 : 0, reservationId);
  const ins = db().prepare("INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)");
  for (const id of tableIds.slice(1)) ins.run(reservationId, id);
}

type DayRes = { id: number; start_min: number; duration_min: number; party_size: number; table_id: number | null; status: string; table_locked: number };

// Ponovno raspoređuje sve potvrđene, ručno nezaključane rezervacije dana.
// Najveće grupe idu prve. Ako bi novi raspored ostavio više gostiju bez stola od starog, ništa se ne mijenja.
export function rearrangeDay(date: string): { moved: number; unseated: number; kept: boolean } {
  const tx = db().transaction(() => {
    const s = getSettings();
    const rows = db()
      .prepare("SELECT id, start_min, duration_min, party_size, table_id, status, table_locked FROM reservations WHERE date = ? AND status IN ('confirmed', 'seated')")
      .all(date) as DayRes[];
    const movable = rows.filter((r) => r.status === "confirmed" && !r.table_locked);
    const before = new Map(movable.map((r) => [r.id, tablesOf(r.id).join(",")]));
    const unseatedBefore = movable.filter((r) => r.table_id == null).length;

    const busy = busyByTable(date, movable.map((r) => r.id));
    const ctx = seatingContext({ online: false });
    const order = [...movable].sort((a, b) => b.party_size - a.party_size || a.start_min - b.start_min || a.id - b.id);
    const plan = new Map<number, number[]>();
    for (const r of order) {
      const end = r.start_min + r.duration_min;
      const seat = findSeat(ctx, busy, r.party_size, r.start_min, end, s);
      if (seat) reserve(busy, seat, r.start_min, end);
      plan.set(r.id, seat?.map((t) => t.id) ?? []);
    }
    const unseated = [...plan.values()].filter((ids) => ids.length === 0).length;
    if (unseated > unseatedBefore) return { moved: 0, unseated: unseatedBefore, kept: true };

    let moved = 0;
    for (const [id, ids] of plan) {
      if (before.get(id) === ids.join(",")) continue;
      setTables(id, ids, false);
      moved++;
    }
    return { moved, unseated, kept: false };
  });
  return tx.immediate();
}

export function tablesOf(reservationId: number): number[] {
  const r = db().prepare("SELECT table_id FROM reservations WHERE id = ?").get(reservationId) as { table_id: number | null } | undefined;
  if (!r?.table_id) return [];
  const extra = db().prepare("SELECT table_id FROM reservation_tables WHERE reservation_id = ? ORDER BY table_id").all(reservationId) as { table_id: number }[];
  return [r.table_id, ...extra.map((e) => e.table_id)];
}
