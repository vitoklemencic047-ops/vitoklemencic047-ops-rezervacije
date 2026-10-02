import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db, getSettings } from "@/lib/db";
import { listForDate, listTables } from "@/lib/reservations";
import { addDays, fmtDate, fmtMin, isDate, nowIn, weekday } from "@/lib/time";
import { setStatusAction } from "./actions";
import { Icon } from "../icons";
import AdminBar from "./AdminBar";
import DateJump from "./DateJump";
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

  const nowLocal = nowIn(s.timezone);
  const showNow = date === today && nowLocal.min >= from && nowLocal.min <= to;
  const confirmedGuests = active.filter((r) => r.status === "confirmed" && r.guest_confirmed_at).length;

  return (
    <>
      <AdminBar name={s.restaurant_name} active="rezervacije" />
      <main className="wrap wide" style={{ paddingTop: 24 }}>
        <div className="day-head">
          <div>
            <div className="muted small">{date === today ? "Danas" : date < today ? "Prošli dan" : "Nadolazeći dan"}</div>
            <h1 style={{ textTransform: "capitalize" }}>{fmtDate(date)}</h1>
          </div>
          <div className="datenav">
            <Link className="btn ghost" href={`/admin?datum=${addDays(date, -1)}`} aria-label="Prethodni dan"><Icon name="left" /></Link>
            <DateJump date={date} />
            <Link className="btn ghost" href={`/admin?datum=${addDays(date, 1)}`} aria-label="Sljedeći dan"><Icon name="right" /></Link>
            {date !== today && <Link className="btn ghost" href="/admin">Danas</Link>}
          </div>
        </div>
        {closed && <div className="msg warn">Restoran je zatvoren ovaj dan{closed.reason ? `: ${closed.reason}` : ""}.</div>}

        <div className="stats">
          <div className="stat"><div className="stat-icon"><Icon name="calendar" /></div><div><b>{active.length}</b><span>rezervacija</span></div></div>
          <div className="stat"><div className="stat-icon gold"><Icon name="users" /></div><div><b>{covers}</b><span>gostiju ukupno</span></div></div>
          <div className="stat"><div className="stat-icon ok"><Icon name="chair" /></div><div><b>{active.filter((r) => r.status === "seated").length}</b><span>trenutno za stolom</span></div></div>
          <div className="stat"><div className="stat-icon ok"><Icon name="check" /></div><div><b>{confirmedGuests}</b><span>potvrdilo dolazak</span></div></div>
          <div className="stat"><div className="stat-icon bad"><Icon name="x" /></div><div><b>{all.filter((r) => r.status === "no_show").length}</b><span>nije došlo</span></div></div>
        </div>

        <h2>Raspored stolova</h2>
        <div className="card timeline" style={{ ["--hour" as string]: `${100 / ((to - from) / 60)}%` }}>
          <div className="tl">
            <div className="tl-hours">
              <div />
              <div>
                {Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60).map((m) => (
                  <span key={m} style={{ left: pct(m) }}>{fmtMin(m)}</span>
                ))}
              </div>
            </div>
            {showNow && <div className="tl-now" style={{ left: `calc((100% - 110px) * ${(nowLocal.min - from) / (to - from)})` }} title="Sada" />}
            {tables.map((t) => (
              <div className="tl-row" key={t.id}>
                <div className="tl-name">{t.name} <small>· {t.max_seats}</small></div>
                <div className="tl-track">
                  {active.filter((r) => r.table_id === t.id && r.status !== "no_show").map((r) => (
                    <div key={r.id} className={`tl-block ${r.status}`}
                      style={{ left: pct(r.start_min), width: `calc(${pct(r.start_min + r.duration_min)} - ${pct(r.start_min)})` }}
                      title={`${fmtMin(r.start_min)} ${r.name}, ${r.party_size} os.`}>
                      {fmtMin(r.start_min)} {r.name} · {r.party_size}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <h2>Popis gostiju</h2>
        <div className="card">
          {all.length === 0 ? <div className="empty">Nema rezervacija za ovaj dan.</div> : (
            <div className="res-list">
              {all.map((r) => (
                <div key={r.id} className={`res ${r.status === "cancelled" ? "dim" : ""}`}>
                  <div className="res-time">{fmtMin(r.start_min)}</div>
                  <div>
                    <div className="res-name">{r.name}</div>
                    <div className="res-meta">
                      <span>{r.party_size} {r.party_size === 1 ? "osoba" : "osobe"}</span>
                      <span>{r.table_name ?? "bez stola"}</span>
                      {r.phone && <a href={`tel:${r.phone.replace(/\s/g, "")}`}>{r.phone}</a>}
                      {r.email && <span>{r.email}</span>}
                      <span>{r.source}</span>
                    </div>
                    {r.note && <div className="res-note">{r.note}</div>}
                  </div>
                  <div className="res-side">
                    <div style={{ textAlign: "right" }}>
                      <span className={`badge b-${r.status}`}>{STATUS[r.status]}</span>
                      {r.status === "confirmed" && r.guest_confirmed_at && <div className="res-flags ok">✓ potvrdio dolazak</div>}
                      {r.status === "confirmed" && !r.guest_confirmed_at && (r.reminder_sent || r.reminder2_sent) ? (
                        <div className="res-flags">podsjetnik poslan</div>
                      ) : null}
                    </div>
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <h2>Nova rezervacija</h2>
        <AddReservation date={date} tables={tables.map((t) => ({ id: t.id, name: `${t.name} (${t.min_seats}–${t.max_seats})` }))} />
      </main>
    </>
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
