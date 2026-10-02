export function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Neispravno vrijeme: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

// 0 = nedjelja
export function weekday(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Trenutni datum i minuta u vremenskoj zoni restorana
export function nowIn(timeZone: string, now = new Date()): { date: string; min: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

const DAYS = ["nedjelja", "ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota"];
export const DAY_NAMES = DAYS;

export function fmtDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${DAYS[weekday(date)]}, ${Number(d)}.${Number(m)}.${y}.`;
}

export const DAY_SHORT = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"];
export const MONTH_SHORT = ["sij", "velj", "ožu", "tra", "svi", "lip", "srp", "kol", "ruj", "lis", "stu", "pro"];

// "sub, 4. lis"
export function fmtShort(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${DAY_SHORT[weekday(date)]}, ${d}. ${MONTH_SHORT[m - 1]}`;
}
