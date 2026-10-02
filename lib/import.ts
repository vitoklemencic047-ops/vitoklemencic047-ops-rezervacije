import crypto from "node:crypto";
import { db, getSettings } from "./db";
import { cancelReservation } from "./cancel";
import { durationFor, getReservation, markReminders, minutesUntil, type Reservation } from "./reservations";
import { busyByTable, findSeat, seatingContext, setTables } from "./seating";
import { isDate, toMin } from "./time";

// Uvoz rezervacija iz vanjskog izvora (webhook, CSV). Vanjski sustav je rezervaciju već prihvatio,
// pa je upisujemo i kad nema slobodnog stola: tada ostaje "bez stola" i osoblje je vidi na tlocrtu.

export type ExternalReservation = {
  izvor: string;          // npr. "algebra", "thefork", "csv"
  id: string;             // ID u vanjskom sustavu
  datum: string;          // YYYY-MM-DD ili DD.MM.YYYY
  vrijeme: string;        // HH:MM
  osobe: number;
  ime: string;
  email?: string;
  telefon?: string;
  napomena?: string;
  status?: string;        // "otkazano" / "cancelled" otkazuje
};

export type ImportResult = {
  id: string; rezultat: "novo" | "promijenjeno" | "otkazano" | "bez promjene" | "greška";
  stol?: string | null; greska?: string;
};

const CANCELLED = new Set(["otkazano", "otkazana", "cancelled", "canceled", "storno"]);

export function normDate(v: string): string | null {
  const t = v.trim();
  if (isDate(t)) return t;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\.?$/.exec(t);
  if (!m) return null;
  const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isDate(d) ? d : null;
}

function tableNames(ids: number[]): string | null {
  if (!ids.length) return null;
  const names = new Map((db().prepare("SELECT id, name FROM tables").all() as { id: number; name: string }[]).map((t) => [t.id, t.name]));
  return ids.map((i) => names.get(i)).join(" + ");
}

// Nađe stol(ove) i upiše ih; vraća nazive ili null ako nema mjesta
function seat(r: Reservation): string | null {
  const s = getSettings();
  const seatTables = findSeat(seatingContext({ online: false }), busyByTable(r.date, [r.id]), r.party_size, r.start_min, r.start_min + r.duration_min, s);
  const ids = seatTables?.map((t) => t.id) ?? [];
  setTables(r.id, ids, false);
  return tableNames(ids);
}

export async function importReservation(x: ExternalReservation): Promise<ImportResult> {
  const source = String(x.izvor ?? "").trim().toLowerCase().slice(0, 40) || "vanjski";
  const extId = String(x.id ?? "").trim().slice(0, 100);
  try {
    if (!extId) throw new Error("Nedostaje id.");
    const existing = db().prepare("SELECT * FROM reservations WHERE external_source = ? AND external_id = ?").get(source, extId) as Reservation | undefined;

    if (CANCELLED.has(String(x.status ?? "").trim().toLowerCase())) {
      if (!existing || existing.status === "cancelled") return { id: extId, rezultat: "bez promjene" };
      await cancelReservation(existing.id, false);
      return { id: extId, rezultat: "otkazano" };
    }

    const date = normDate(String(x.datum ?? ""));
    if (!date) throw new Error(`Neispravan datum: ${x.datum}`);
    const tm = /^(\d{1,2})[:.](\d{2})/.exec(String(x.vrijeme ?? "").trim());
    if (!tm) throw new Error(`Neispravno vrijeme: ${x.vrijeme}`);
    const start = toMin(`${tm[1]}:${tm[2]}`);
    const party = Math.trunc(Number(x.osobe));
    if (!(party >= 1 && party <= 200)) throw new Error(`Neispravan broj osoba: ${x.osobe}`);
    const name = String(x.ime ?? "").trim().slice(0, 100);
    if (!name) throw new Error("Nedostaje ime.");
    const s = getSettings();
    const duration = durationFor(party, s);
    const fields = {
      email: String(x.email ?? "").trim().slice(0, 200) || null,
      phone: String(x.telefon ?? "").trim().slice(0, 40) || null,
      note: String(x.napomena ?? "").trim().slice(0, 500) || null,
    };

    const tx = db().transaction((): ImportResult => {
      if (existing) {
        const moved = existing.date !== date || existing.start_min !== start || existing.party_size !== party;
        const revived = existing.status === "cancelled";
        db().prepare(
          `UPDATE reservations SET date = ?, start_min = ?, duration_min = ?, party_size = ?, name = ?, email = ?, phone = ?, note = ?,
           status = CASE WHEN status = 'cancelled' THEN 'confirmed' ELSE status END WHERE id = ?`,
        ).run(date, start, moved ? duration : existing.duration_min, party, name, fields.email, fields.phone, fields.note, existing.id);
        const r = getReservation(existing.id)!;
        if (!moved && !revived) return { id: extId, rezultat: "bez promjene", stol: tableNames(tablesFor(r)) };
        return { id: extId, rezultat: "promijenjeno", stol: seat(r) };
      }
      const token = crypto.randomBytes(16).toString("base64url");
      const info = db().prepare(
        `INSERT INTO reservations (token, date, start_min, duration_min, party_size, name, email, phone, note, source, external_source, external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(token, date, start, duration, party, name, fields.email, fields.phone, fields.note, source, source, extId);
      const id = Number(info.lastInsertRowid);
      const until = minutesUntil({ date, start_min: start }, s.timezone);
      markReminders(id, until <= s.reminder1_hours * 60, until <= s.reminder2_hours * 60);
      return { id: extId, rezultat: "novo", stol: seat(getReservation(id)!) };
    });
    return tx.immediate();
  } catch (e) {
    return { id: extId, rezultat: "greška", greska: e instanceof Error ? e.message : String(e) };
  }
}

function tablesFor(r: Reservation): number[] {
  if (!r.table_id) return [];
  const extra = db().prepare("SELECT table_id FROM reservation_tables WHERE reservation_id = ?").all(r.id) as { table_id: number }[];
  return [r.table_id, ...extra.map((e) => e.table_id)];
}

// CSV iz Excela ili drugog sustava. Prepoznaje hrvatske i engleske nazive stupaca, odvajanje ; ili ,
const ALIASES: Record<keyof Omit<ExternalReservation, "izvor">, string[]> = {
  id: ["id", "broj", "rezervacija", "booking id", "reservation id", "ref"],
  datum: ["datum", "date", "dan"],
  vrijeme: ["vrijeme", "time", "sat", "termin"],
  osobe: ["osobe", "broj osoba", "osoba", "gosti", "guests", "party", "pax", "covers"],
  ime: ["ime", "ime i prezime", "gost", "name", "guest"],
  email: ["email", "e-mail", "mail"],
  telefon: ["telefon", "mobitel", "tel", "phone", "mobile"],
  napomena: ["napomena", "napomene", "note", "notes", "komentar"],
  status: ["status", "stanje"],
};

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function csvToReservations(text: string, source: string): ExternalReservation[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new Error("CSV nema redaka s rezervacijama.");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(
    Object.entries(ALIASES).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]),
  ) as Record<keyof typeof ALIASES, number>;
  for (const k of ["datum", "vrijeme", "osobe", "ime"] as const) {
    if (col[k] < 0) throw new Error(`CSV nema stupac "${k}". Stupci: ${head.join(", ")}`);
  }
  return rows.slice(1).map((r) => {
    const get = (k: keyof typeof ALIASES) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");
    const out: ExternalReservation = {
      izvor: source, id: get("id"), datum: get("datum"), vrijeme: get("vrijeme"),
      osobe: Number(get("osobe")), ime: get("ime"), email: get("email"), telefon: get("telefon"),
      napomena: get("napomena"), status: get("status"),
    };
    // Bez stupca s ID-om: ID iz sadržaja, da ponovni uvoz iste datoteke ne udvostruči rezervacije
    if (!out.id) out.id = crypto.createHash("sha1").update([out.datum, out.vrijeme, out.ime, out.telefon].join("|")).digest("hex").slice(0, 16);
    return out;
  });
}
