import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db, getSettings } from "@/lib/db";
import { listForDate, listTables } from "@/lib/reservations";
import { addDays, fmtDate, fmtMin, isDate, nowIn, weekday } from "@/lib/time";
import { logoutAction, setStatusAction } from "./actions";
import AddReservation from "./AddReservation";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  confirmed: "Potvrđeno", seated: "Za stolom", completed: "Završeno", cancelled: "Otkazano", no_show: "Nije došao",
};

export default async function Admin({ searchParams }: { searchParams: Promise<{ datum?: string }> }) {
  await requireAdmin();
  const s = getSettings();
  const today = nowIn(s.timezone).date;
  const { datum } = await searchParams;
  const date = isDate(datum) ? datum : today;
  const all = listForDate(date);
  const active = all.filter((r) => r.status !== "cancelled");
  const tables = listTables().filter((t) => t.active);
  const covers = active.filter((r) => r.status !== "no_show").reduce((n, r) => n + r.party_size, 0);

  const hours = db().prepare("SELECT MIN(open_min) a, MAX(close_min) b FROM opening_hours WHERE weekday = ?")
    .get(weekday(date)) as { a: number | null; b: number | null };
  const from = Math.floor((hours.a ?? 10 * 60) / 60) * 60;
  const to = Math.ceil((hours.b ?? 24 * 60) / 60) * 60;
  const pct = (m: number) => `${((m - from) / (to - from)) * 100}%`;
  const closed = db().prepare("SELECT reason FROM closed_dates WHERE date = ?").get(date) as { reason: string } | undefined;

  return (
    <main className="wrap wide">
      <nav className="admin">
        <b>{s.restaurant_name}</b>
        <Link href="/admin">Rezervacije</Link>
        <Link href="/admin/postavke">Postavke</Link>
        <Link href="/" target="_blank">Javna stranica</Link>
        <form action={logoutAction} style={{ marginLeft: "auto" }}><button className="ghost small">Odjava</button></form>
      </nav>

      <div className="toolbar">
        <Link className="btn ghost" href={`/admin?datum=${addDays(date, -1)}`}>←</Link>
        <form>
          <input type="date" name="datum" defaultValue={date} style={{ width: "auto" }} />{" "}
          <button className="ghost">Prikaži</button>
        </form>
        <Link className="btn ghost" href={`/admin?datum=${addDays(date, 1)}`}>→</Link>
        {date !== today && <Link href="/admin">Danas</Link>}
      </div>
      <h1 style={{ marginTop: 16 }}>{fmtDate(date)}</h1>
      {closed && <div className="msg warn">Restoran je zatvoren ovaj dan{closed.reason ? `: ${closed.reason}` : ""}.</div>}

      <div className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><b>{active.length}</b><span className="muted">rezervacija</span></div>
        <div className="stat"><b>{covers}</b><span className="muted">gostiju</span></div>
        <div className="stat"><b>{active.filter((r) => r.status === "seated").length}</b><span className="muted">za stolom</span></div>
        <div className="stat"><b>{all.filter((r) => r.status === "no_show").length}</b><span className="muted">nije došlo</span></div>
      </div>

      <h2>Raspored stolova</h2>
      <div className="card timeline">
        <div className="tl">
          <div className="tl-hours">
            <div />
            <div>
              {Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60).map((m) => (
                <span key={m} style={{ left: pct(m) }}>{fmtMin(m)}</span>
              ))}
            </div>
          </div>
          {tables.map((t) => (
            <div className="tl-row" key={t.id}>
              <div className="tl-name">{t.name} <span>({t.max_seats})</span></div>
              <div className="tl-track">
                {active.filter((r) => r.table_id === t.id && r.status !== "no_show").map((r) => (
                  <div key={r.id} className={`tl-block ${r.status}`}
                    style={{ left: pct(r.start_min), width: `calc(${pct(r.start_min + r.duration_min)} - ${pct(r.start_min)})` }}
                    title={`${fmtMin(r.start_min)} ${r.name}, ${r.party_size} os.`}>
                    {fmtMin(r.start_min)} {r.name} ({r.party_size})
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <h2>Popis</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        {all.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nema rezervacija za ovaj dan.</p> : (
          <table className="list">
            <thead>
              <tr><th>Vrijeme</th><th>Gost</th><th>Os.</th><th>Stol</th><th className="hide-sm">Kontakt</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.id} style={r.status === "cancelled" ? { opacity: 0.5 } : undefined}>
                  <td>{fmtMin(r.start_min)}</td>
                  <td>
                    <b>{r.name}</b>
                    {r.note && <div className="muted">{r.note}</div>}
                    <div className="muted" style={{ fontSize: 12 }}>{r.source}</div>
                  </td>
                  <td>{r.party_size}</td>
                  <td>{r.table_name ?? "—"}</td>
                  <td className="hide-sm">{r.phone}<div className="muted">{r.email}</div></td>
                  <td><span className={`badge b-${r.status}`}>{STATUS[r.status]}</span></td>
                  <td>
                    <div className="toolbar">
                      {r.status === "confirmed" && <StatusButton id={r.id} status="seated" label="Stigli" />}
                      {r.status === "seated" && <StatusButton id={r.id} status="completed" label="Otišli" />}
                      {r.status === "confirmed" && <StatusButton id={r.id} status="no_show" label="Nisu došli" ghost />}
                      {(r.status === "confirmed" || r.status === "seated") && (
                        <StatusButton id={r.id} status="cancelled" label="Otkaži" ghost notify />
                      )}
                      {(r.status === "no_show" || r.status === "completed") && (
                        <StatusButton id={r.id} status="confirmed" label="Vrati" ghost />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Nova rezervacija (telefon, walk-in)</h2>
      <AddReservation date={date} tables={tables.map((t) => ({ id: t.id, name: `${t.name} (${t.min_seats}–${t.max_seats})` }))} />
    </main>
  );
}

function StatusButton({ id, status, label, ghost, notify }: { id: number; status: string; label: string; ghost?: boolean; notify?: boolean }) {
  return (
    <form action={setStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      {notify && <input type="hidden" name="obavijesti" value="1" />}
      <button className={`small ${ghost ? "ghost" : ""}`}>{label}</button>
    </form>
  );
}
