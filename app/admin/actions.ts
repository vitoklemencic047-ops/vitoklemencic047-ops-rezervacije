"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPassword, login, logout, requireAdmin } from "@/lib/auth";
import { db, DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/db";
import { cancelReservation } from "@/lib/cancel";
import { sendConfirmation } from "@/lib/notify";
import { BookingError, createReservation, setStatus, type Status } from "@/lib/reservations";
import { isDate, toMin } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function loginAction(_: unknown, f: FormData) {
  if (!checkPassword(str(f, "lozinka"))) return { error: "Pogrešna lozinka." };
  await login();
  redirect("/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/admin/prijava");
}

export async function setStatusAction(f: FormData) {
  await requireAdmin();
  const id = Number(f.get("id"));
  const status = str(f, "status") as Status;
  if (status === "cancelled") await cancelReservation(id, f.get("obavijesti") === "1");
  else if (["confirmed", "seated", "completed", "no_show"].includes(status)) setStatus(id, status);
  revalidatePath("/admin");
}

export async function addReservationAction(_: unknown, f: FormData) {
  await requireAdmin();
  const date = str(f, "datum");
  const party = Number(f.get("osobe"));
  const tableId = str(f, "stol");
  try {
    if (!isDate(date) || !party || party < 1) return { error: "Upišite datum i broj osoba." };
    const name = str(f, "ime");
    if (!name) return { error: "Upišite ime gosta." };
    const r = createReservation(
      {
        date, start_min: toMin(str(f, "vrijeme")), party_size: party, name,
        email: str(f, "email"), phone: str(f, "telefon"), note: str(f, "napomena"),
        table_id: tableId ? Number(tableId) : null,
      },
      { online: false, source: str(f, "izvor") || "telefon" },
    );
    if (r.email && f.get("posalji") === "1") await sendConfirmation(r);
    revalidatePath("/admin");
    return { ok: `Rezervacija za ${r.name} je upisana.` };
  } catch (e) {
    if (e instanceof BookingError || e instanceof Error) return { error: e.message };
    throw e;
  }
}

export async function saveSettingsAction(f: FormData) {
  await requireAdmin();
  const values: Partial<Record<keyof Settings, string>> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = f.get(k);
    if (v !== null) values[k] = String(v).trim();
  }
  saveSettings(values);
  revalidatePath("/admin/postavke");
}

export async function saveHoursAction(f: FormData) {
  await requireAdmin();
  // Format po danu: "12:00-15:00, 18:00-23:00", prazno = zatvoreno
  const rows: [number, number, number][] = [];
  for (let d = 0; d < 7; d++) {
    for (const part of str(f, `dan${d}`).split(",").map((p) => p.trim()).filter(Boolean)) {
      const [a, b] = part.split("-").map((x) => toMin(x));
      if (!(b > a)) throw new Error(`Neispravno radno vrijeme: ${part}`);
      rows.push([d, a, b]);
    }
  }
  db().transaction(() => {
    db().prepare("DELETE FROM opening_hours").run();
    const ins = db().prepare("INSERT INTO opening_hours (weekday, open_min, close_min) VALUES (?, ?, ?)");
    rows.forEach((r) => ins.run(...r));
  })();
  revalidatePath("/admin/postavke");
}

export async function saveTableAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  const vals = [str(f, "naziv"), Number(f.get("min")) || 1, Number(f.get("max")) || 2, f.get("online") ? 1 : 0, f.get("aktivan") ? 1 : 0];
  if (id) db().prepare("UPDATE tables SET name = ?, min_seats = ?, max_seats = ?, online = ?, active = ? WHERE id = ?").run(...vals, Number(id));
  else db().prepare("INSERT INTO tables (name, min_seats, max_seats, online, active) VALUES (?, ?, ?, ?, ?)").run(...vals);
  revalidatePath("/admin/postavke");
}

export async function closedDateAction(f: FormData) {
  await requireAdmin();
  const date = str(f, "datum");
  if (!isDate(date)) return;
  if (f.get("ukloni")) db().prepare("DELETE FROM closed_dates WHERE date = ?").run(date);
  else db().prepare("INSERT OR REPLACE INTO closed_dates (date, reason) VALUES (?, ?)").run(date, str(f, "razlog"));
  revalidatePath("/admin/postavke");
}
