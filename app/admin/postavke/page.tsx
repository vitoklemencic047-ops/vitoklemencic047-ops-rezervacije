import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db, getSettings } from "@/lib/db";
import { listTables } from "@/lib/reservations";
import { DAY_NAMES, fmtDate, fmtMin } from "@/lib/time";
import { closedDateAction, saveHoursAction, saveSettingsAction, saveTableAction } from "../actions";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  restaurant_name: "Naziv restorana",
  phone: "Telefon",
  timezone: "Vremenska zona",
  slot_interval: "Razmak termina (min)",
  duration_small: "Trajanje, 1–4 osobe (min)",
  duration_large: "Trajanje, 5+ osoba (min)",
  buffer: "Pospremanje stola (min)",
  min_notice: "Najkasnije unaprijed (min)",
  max_days_ahead: "Najviše dana unaprijed",
  max_party_online: "Najveća grupa online",
};

export default async function SettingsPage() {
  await requireAdmin();
  const s = getSettings();
  const hours = db().prepare("SELECT * FROM opening_hours ORDER BY weekday, open_min").all() as
    { weekday: number; open_min: number; close_min: number }[];
  const closed = db().prepare("SELECT * FROM closed_dates WHERE date >= date('now') ORDER BY date").all() as
    { date: string; reason: string | null }[];
  const tables = listTables();
  const order = [1, 2, 3, 4, 5, 6, 0];

  return (
    <main className="wrap wide">
      <nav className="admin">
        <b>{s.restaurant_name}</b>
        <Link href="/admin">Rezervacije</Link>
        <Link href="/admin/postavke">Postavke</Link>
      </nav>
      <h1>Postavke</h1>

      <h2>Općenito</h2>
      <form className="card" action={saveSettingsAction}>
        <div className="row">
          {Object.entries(s).map(([k, v]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{LABELS[k] ?? k}</label>
              <input id={k} name={k} defaultValue={String(v)} type={typeof v === "number" ? "number" : "text"} />
            </div>
          ))}
        </div>
        <button>Spremi</button>
      </form>

      <h2>Radno vrijeme</h2>
      <form className="card" action={saveHoursAction}>
        <p className="muted" style={{ marginTop: 0 }}>Format: 12:00-15:00, 18:00-23:00. Prazno znači zatvoreno.</p>
        <div className="row">
          {order.map((d) => (
            <div className="field" key={d}>
              <label htmlFor={`dan${d}`} style={{ textTransform: "capitalize" }}>{DAY_NAMES[d]}</label>
              <input id={`dan${d}`} name={`dan${d}`}
                defaultValue={hours.filter((h) => h.weekday === d).map((h) => `${fmtMin(h.open_min)}-${fmtMin(h.close_min)}`).join(", ")} />
            </div>
          ))}
        </div>
        <button>Spremi radno vrijeme</button>
      </form>

      <h2>Neradni dani</h2>
      <div className="card">
        <form action={closedDateAction} className="row">
          <div className="field"><label>Datum</label><input type="date" name="datum" required /></div>
          <div className="field"><label>Razlog</label><input name="razlog" placeholder="npr. Božić, privatni događaj" /></div>
          <div className="field" style={{ alignSelf: "end" }}><button>Dodaj</button></div>
        </form>
        {closed.map((c) => (
          <form key={c.date} action={closedDateAction} className="toolbar" style={{ marginTop: 8 }}>
            <input type="hidden" name="datum" value={c.date} />
            <input type="hidden" name="ukloni" value="1" />
            <span>{fmtDate(c.date)} {c.reason && <span className="muted">· {c.reason}</span>}</span>
            <button className="ghost small">Ukloni</button>
          </form>
        ))}
      </div>

      <h2>Stolovi</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="list">
          <thead>
            <tr><th colSpan={6} style={{ padding: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 70px", gap: 8 }}>
                <span>Naziv</span><span>Min osoba</span><span>Max osoba</span><span>Online</span><span>Aktivan</span><span />
              </div>
            </th></tr>
          </thead>
          <tbody>
            {[...tables, null].map((t) => (
              <tr key={t?.id ?? "novi"}>
                <td colSpan={6} style={{ padding: 0 }}>
                  <form action={saveTableAction} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 70px", gap: 8, padding: "6px 0", alignItems: "center" }}>
                    {t && <input type="hidden" name="id" value={t.id} />}
                    <input name="naziv" defaultValue={t?.name ?? ""} placeholder="Novi stol" required />
                    <input name="min" type="number" min={1} defaultValue={t?.min_seats ?? 1} />
                    <input name="max" type="number" min={1} defaultValue={t?.max_seats ?? 4} />
                    <input name="online" type="checkbox" defaultChecked={t ? !!t.online : true} style={{ width: "auto" }} />
                    <input name="aktivan" type="checkbox" defaultChecked={t ? !!t.active : true} style={{ width: "auto" }} />
                    <button className="small">{t ? "Spremi" : "Dodaj"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Stol koji nije "online" ostaje samo za telefonske rezervacije i walk-in goste.</p>
      </div>
    </main>
  );
}
