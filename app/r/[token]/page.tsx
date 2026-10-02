import { notFound, redirect } from "next/navigation";
import { getSettings } from "@/lib/db";
import { confirmAttendance, getByToken } from "@/lib/reservations";
import { cancelReservation } from "@/lib/cancel";
import { fmtDate, fmtMin, fmtShort, nowIn } from "@/lib/time";
import { Icon } from "@/app/icons";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  confirmed: "Potvrđeno", seated: "Za stolom", completed: "Završeno", cancelled: "Otkazano", no_show: "Niste došli",
};

export default async function ReservationPage({
  params, searchParams,
}: { params: Promise<{ token: string }>; searchParams: Promise<{ nova?: string }> }) {
  const { token } = await params;
  const { nova } = await searchParams;
  const r = getByToken(token);
  if (!r) notFound();
  const s = getSettings();
  const now = nowIn(s.timezone);
  const upcoming = r.date > now.date || (r.date === now.date && r.start_min > now.min);
  const canCancel = r.status === "confirmed" && upcoming;

  async function cancel() {
    "use server";
    const current = getByToken(token);
    if (current && current.status === "confirmed") await cancelReservation(current.id, true);
    redirect(`/r/${token}`);
  }

  async function confirm() {
    "use server";
    const current = getByToken(token);
    if (current && current.status === "confirmed") confirmAttendance(current.id);
    redirect(`/r/${token}`);
  }

  const cancelled = r.status === "cancelled";
  const head = cancelled
    ? { icon: "x" as const, title: "Rezervacija je otkazana", text: "Hvala što ste nam javili. Nadamo se da se vidimo drugom prilikom." }
    : r.guest_confirmed_at && canCancel
      ? { icon: "check" as const, title: "Vidimo se!", text: "Potvrdili ste dolazak. Stol vas čeka." }
      : nova
        ? { icon: "check" as const, title: "Rezervacija je potvrđena", text: `Potvrdu smo poslali na ${r.email}.` }
        : { icon: "calendar" as const, title: "Vaša rezervacija", text: STATUS[r.status] };

  return (
    <main className="wrap" style={{ paddingTop: 40 }}>
      <div className="confirm-head">
        <div className={`check ${cancelled ? "cancel" : ""}`}><Icon name={head.icon} size={30} /></div>
        <h1>{head.title}</h1>
        <p className="muted" style={{ margin: "4px 0 20px" }}>{head.text}</p>
      </div>

      <div className="ticket" style={cancelled ? { opacity: 0.6 } : undefined}>
        <div className="ticket-top">
          <div className="eyebrow">{s.restaurant_name}</div>
          <div className="big">{r.name}</div>
        </div>
        <div className="ticket-grid">
          <div><div className="k">Datum</div><div className="v">{fmtShort(r.date)}</div></div>
          <div><div className="k">Vrijeme</div><div className="v">{fmtMin(r.start_min)}</div></div>
          <div><div className="k">Gosti</div><div className="v">{r.party_size}</div></div>
        </div>
        <div className="ticket-body">
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span className={`badge b-${r.status}`}>{STATUS[r.status]}</span>
            <span className="muted small">{fmtDate(r.date)}</span>
          </div>
          {r.note && <div className="res-note" style={{ marginTop: 12 }}>{r.note}</div>}

          {canCancel && (
            <div className="actions">
              {!r.guest_confirmed_at && (
                <form action={confirm} className="full"><button className="block"><Icon name="check" />Potvrđujem dolazak</button></form>
              )}
              <a className="btn ghost" href={`/r/${token}/kalendar.ics`}><Icon name="calendar" />U kalendar</a>
              <a className="btn ghost" href={`tel:${s.phone.replace(/\s/g, "")}`}><Icon name="phone" />Nazovi</a>
              <details className="full">
                <summary className="muted small" style={{ cursor: "pointer", textAlign: "center", padding: "8px 0" }}>Ne možete doći?</summary>
                <form action={cancel} style={{ marginTop: 8 }}>
                  <button className="block ghost" style={{ color: "var(--bad)" }}><Icon name="x" />Da, otkaži rezervaciju</button>
                </form>
              </details>
            </div>
          )}
        </div>
      </div>

      <p className="foot">
        Promjena termina? Otkažite ovu i <a href="/">rezervirajte novu</a>, ili nas nazovite na {s.phone}.
      </p>
    </main>
  );
}
