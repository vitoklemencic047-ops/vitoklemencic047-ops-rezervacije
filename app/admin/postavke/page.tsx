import { requireAdmin } from "@/lib/auth";
import { db, getSettings } from "@/lib/db";
import { listTables } from "@/lib/reservations";
import { DAY_NAMES, fmtDate, fmtMin } from "@/lib/time";
import { Icon } from "../../icons";
import AdminBar from "../AdminBar";
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
  reminder1_hours: "1. podsjetnik, sati prije (0 = isklj.)",
  reminder2_hours: "2. podsjetnik, sati prije (0 = isklj.)",
  reminder_channels: "Kanali podsjetnika (email, sms, whatsapp)",
  country_code: "Pozivni broj države",
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
    <>
      <AdminBar name={s.restaurant_name} active="postavke" />
      <main className="wrap wide" style={{ paddingTop: 24 }}>
        <h1>Postavke</h1>
        <p className="muted" style={{ marginTop: 0 }}>Promjene vrijede odmah za nove rezervacije.</p>

        <h2>Općenito i podsjetnici</h2>
        <form className="card" action={saveSettingsAction}>
          <div className="set-grid">
            {Object.entries(s).map(([k, v]) => (
              <div className="field" key={k}>
                <label htmlFor={k}>{LABELS[k] ?? k}</label>
                <input id={k} name={k} defaultValue={String(v)} type={typeof v === "number" ? "number" : "text"} />
              </div>
            ))}
          </div>
          <button>Spremi postavke</button>
        </form>

        <h2>Radno vrijeme</h2>
        <form className="card" action={saveHoursAction}>
          <p className="muted small" style={{ marginTop: 0 }}>Format: 12:00-15:00, 18:00-23:00. Prazno znači zatvoreno.</p>
          <div className="set-grid">
            {order.map((d) => (
              <div className="field" key={d}>
                <label htmlFor={`dan${d}`} style={{ textTransform: "capitalize" }}>{DAY_NAMES[d]}</label>
                <input id={`dan${d}`} name={`dan${d}`} placeholder="zatvoreno"
                  defaultValue={hours.filter((h) => h.weekday === d).map((h) => `${fmtMin(h.open_min)}-${fmtMin(h.close_min)}`).join(", ")} />
              </div>
            ))}
          </div>
          <button>Spremi radno vrijeme</button>
        </form>

        <h2>Neradni dani</h2>
        <div className="card">
          <form action={closedDateAction} className="row" style={{ alignItems: "end" }}>
            <div className="field"><label>Datum</label><input type="date" name="datum" required /></div>
            <div className="field"><label>Razlog</label><input name="razlog" placeholder="npr. Božić, privatni događaj" /></div>
            <div className="field"><button style={{ width: "100%" }}><Icon name="plus" size={16} />Dodaj</button></div>
          </form>
          {closed.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nema nadolazećih neradnih dana.</p>}
          {closed.map((c) => (
            <form key={c.date} action={closedDateAction} className="closed-item">
              <input type="hidden" name="datum" value={c.date} />
              <input type="hidden" name="ukloni" value="1" />
              <span><b style={{ textTransform: "capitalize" }}>{fmtDate(c.date)}</b> {c.reason && <span className="muted">· {c.reason}</span>}</span>
              <button className="ghost small">Ukloni</button>
            </form>
          ))}
        </div>

        <h2>Stolovi</h2>
        <div className="card">
          <div className="table-row head"><span>Naziv</span><span>Min osoba</span><span>Max osoba</span><span style={{ textAlign: "center" }}>Online</span><span style={{ textAlign: "center" }}>Aktivan</span><span /></div>
          {[...tables, null].map((t) => (
            <form key={t?.id ?? "novi"} action={saveTableAction} className="table-row" style={!t ? { borderTop: "1px dashed var(--line)", marginTop: 8, paddingTop: 12 } : undefined}>
              {t && <input type="hidden" name="id" value={t.id} />}
              <input name="naziv" defaultValue={t?.name ?? ""} placeholder="Novi stol" required aria-label="Naziv" />
              <input name="min" type="number" min={1} defaultValue={t?.min_seats ?? 1} aria-label="Min osoba" />
              <input name="max" type="number" min={1} defaultValue={t?.max_seats ?? 4} aria-label="Max osoba" />
              <input name="online" type="checkbox" defaultChecked={t ? !!t.online : true} aria-label="Online" />
              <input name="aktivan" type="checkbox" defaultChecked={t ? !!t.active : true} aria-label="Aktivan" />
              <button className={`small ${t ? "ghost" : ""}`}>{t ? "Spremi" : "Dodaj"}</button>
            </form>
          ))}
          <p className="muted small" style={{ marginBottom: 0 }}>Stol koji nije "online" ostaje samo za telefonske rezervacije i walk-in goste.</p>
        </div>
      </main>
    </>
  );
}
