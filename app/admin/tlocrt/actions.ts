"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db, getSettings } from "@/lib/db";
import { saveFloorImage, setFloorHeight } from "@/lib/floor";
import { csvToReservations, importReservation, type ImportResult } from "@/lib/import";
import { getReservation } from "@/lib/reservations";
import { busyByTable, findSeat, isFree, rearrangeDay, seatingContext, setTables } from "@/lib/seating";

export type LayoutTable = {
  id: number | null; name: string; min_seats: number; max_seats: number;
  x: number | null; y: number | null; w: number; h: number; rot: number;
  shape: "rect" | "round"; zone: string; combinable: boolean; online: boolean; active: boolean;
};

type Result = { ok?: string; error?: string };

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export async function saveLayoutAction(tables: LayoutTable[], removed: number[], floorHeight: number): Promise<Result> {
  await requireAdmin();
  try {
    db().transaction(() => {
      setFloorHeight(floorHeight);
      const upd = db().prepare(
        `UPDATE tables SET name = ?, min_seats = ?, max_seats = ?, x = ?, y = ?, w = ?, h = ?, rot = ?, shape = ?, zone = ?,
         combinable = ?, online = ?, active = ? WHERE id = ?`,
      );
      const ins = db().prepare(
        `INSERT INTO tables (name, min_seats, max_seats, x, y, w, h, rot, shape, zone, combinable, online, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const t of tables) {
        const name = String(t.name ?? "").trim().slice(0, 40);
        if (!name) throw new Error("Svaki stol mora imati naziv.");
        const max = Math.round(num(t.max_seats, 1, 100, 2));
        const vals = [
          name, Math.round(num(t.min_seats, 1, max, 1)), max,
          t.x == null ? null : num(t.x, -100, 1100, 0), t.y == null ? null : num(t.y, -100, 5100, 0),
          num(t.w, 10, 600, 70), num(t.h, 10, 600, 70), num(t.rot, -360, 360, 0) % 360,
          t.shape === "round" ? "round" : "rect", String(t.zone ?? "").trim().slice(0, 30),
          t.combinable ? 1 : 0, t.online ? 1 : 0, t.active ? 1 : 0,
        ] as const;
        if (t.id) upd.run(...vals, t.id);
        else ins.run(...vals);
      }
      // Stol s rezervacijama se ne briše nego isključi, da povijest ostane točna
      for (const id of removed) {
        const used = db().prepare(
          "SELECT 1 FROM reservations WHERE table_id = ? UNION SELECT 1 FROM reservation_tables WHERE table_id = ? LIMIT 1",
        ).get(id, id);
        if (used) db().prepare("UPDATE tables SET active = 0, x = NULL, y = NULL WHERE id = ?").run(id);
        else db().prepare("DELETE FROM tables WHERE id = ?").run(id);
      }
    })();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Spremanje nije uspjelo." };
  }
  revalidatePath("/admin/tlocrt");
  revalidatePath("/admin");
  return { ok: "Tlocrt je spremljen." };
}

export async function uploadFloorAction(f: FormData): Promise<Result> {
  await requireAdmin();
  const file = f.get("slika");
  if (!(file instanceof File) || file.size === 0) return { error: "Odaberite sliku tlocrta." };
  if (file.size > 15 * 1024 * 1024) return { error: "Slika je veća od 15 MB." };
  try {
    saveFloorImage(Buffer.from(await file.arrayBuffer()), file.type, Number(f.get("omjer")));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Učitavanje nije uspjelo." };
  }
  revalidatePath("/admin/tlocrt");
  return { ok: "Tlocrt je učitan." };
}

// Ručni odabir stolova za rezervaciju; prazan popis = vrati na automatski raspored
export async function assignTablesAction(reservationId: number, tableIds: number[]): Promise<Result> {
  await requireAdmin();
  tableIds = [...new Set((Array.isArray(tableIds) ? tableIds : []).map(Number).filter(Number.isInteger))];
  const r = getReservation(Number(reservationId));
  if (!r) return { error: "Rezervacija ne postoji." };
  const s = getSettings();
  const res = db().transaction((): Result => {
    const busy = busyByTable(r.date, [r.id]);
    const end = r.start_min + r.duration_min;
    if (tableIds.length === 0) {
      const seat = findSeat(seatingContext({ online: false }), busy, r.party_size, r.start_min, end, s);
      setTables(r.id, seat?.map((t) => t.id) ?? [], false);
      return seat ? { ok: `${r.name}: ${seat.map((t) => t.name).join(" + ")} (automatski)` } : { error: `Za ${r.name} trenutno nema slobodnog stola.` };
    }
    const tables = db().prepare(`SELECT id, name, max_seats FROM tables WHERE id IN (${tableIds.map(() => "?").join(",")})`)
      .all(...tableIds) as { id: number; name: string; max_seats: number }[];
    if (tables.length !== new Set(tableIds).size) return { error: "Nepoznat stol." };
    const taken = tables.filter((t) => !isFree(busy.get(t.id), r.start_min, end, s.buffer));
    if (taken.length) return { error: `${taken.map((t) => t.name).join(", ")} je zauzet u to vrijeme.` };
    setTables(r.id, tableIds, true);
    const seats = tables.reduce((n, t) => n + t.max_seats, 0);
    return { ok: `${r.name} → ${tables.map((t) => t.name).join(" + ")}${seats < r.party_size ? ` (pazi: ${seats} mjesta za ${r.party_size} osoba)` : ""}` };
  }).immediate();
  revalidatePath("/admin/tlocrt");
  revalidatePath("/admin");
  return res;
}

export async function rearrangeAction(date: string): Promise<Result> {
  await requireAdmin();
  const r = rearrangeDay(date);
  revalidatePath("/admin/tlocrt");
  revalidatePath("/admin");
  if (r.kept) return { error: "Novi raspored ne bi bio bolji od postojećeg, ništa nije promijenjeno." };
  return {
    ok: `Raspored napravljen: premješteno ${r.moved}.` + (r.unseated ? ` Bez stola ostaje ${r.unseated}.` : " Svi gosti imaju stol."),
  };
}

export async function importCsvAction(f: FormData): Promise<Result> {
  await requireAdmin();
  const file = f.get("datoteka");
  if (!(file instanceof File) || file.size === 0) return { error: "Odaberite CSV datoteku." };
  try {
    const items = csvToReservations(await file.text(), String(f.get("izvor") || "csv").trim().toLowerCase());
    const results: ImportResult[] = [];
    for (const x of items) results.push(await importReservation(x));
    const count = (k: string) => results.filter((r) => r.rezultat === k).length;
    const errors = results.filter((r) => r.rezultat === "greška");
    const noTable = results.filter((r) => (r.rezultat === "novo" || r.rezultat === "promijenjeno") && !r.stol).length;
    revalidatePath("/admin/tlocrt");
    revalidatePath("/admin");
    const msg = `Uvezeno: ${count("novo")} novih, ${count("promijenjeno")} promijenjenih, ${count("otkazano")} otkazanih, ${count("bez promjene")} bez promjene.`
      + (noTable ? ` Bez stola: ${noTable}.` : "");
    if (errors.length) return { error: `${msg} Greške (${errors.length}): ${errors.slice(0, 3).map((e) => e.greska).join("; ")}` };
    return { ok: msg };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Uvoz nije uspio." };
  }
}
