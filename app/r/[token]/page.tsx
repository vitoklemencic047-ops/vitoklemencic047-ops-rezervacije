import { notFound, redirect } from "next/navigation";
import { getSettings } from "@/lib/db";
import { getByToken } from "@/lib/reservations";
import { cancelReservation } from "@/lib/cancel";
import { fmtDate, fmtMin, nowIn } from "@/lib/time";

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

  return (
    <main className="wrap">
      <h1>{s.restaurant_name}</h1>
      {nova && r.status === "confirmed" && (
        <div className="msg ok">Rezervacija je potvrđena. Poslali smo vam potvrdu na {r.email}.</div>
      )}
      <div className="card">
        <p><span className={`badge b-${r.status}`}>{STATUS[r.status]}</span></p>
        <p style={{ fontSize: 20, margin: "8px 0" }}>
          <b>{fmtDate(r.date)}</b> u <b>{fmtMin(r.start_min)}</b>
        </p>
        <p className="muted" style={{ margin: 0 }}>
          {r.party_size} {r.party_size === 1 ? "osoba" : "osobe/a"} · na ime {r.name}
        </p>
        {r.note && <p className="muted">Napomena: {r.note}</p>}
        {canCancel && (
          <form action={cancel} style={{ marginTop: 16 }}>
            <button className="ghost">Otkaži rezervaciju</button>
          </form>
        )}
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        Promjena termina? Otkažite ovu i <a href="/">rezervirajte novu</a>, ili nas nazovite na {s.phone}.
      </p>
    </main>
  );
}
