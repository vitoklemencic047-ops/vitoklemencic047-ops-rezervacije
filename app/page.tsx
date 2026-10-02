import { db, getSettings } from "@/lib/db";
import { addDays, fmtMin, nowIn, weekday } from "@/lib/time";
import { Icon } from "./icons";
import BookingForm from "./BookingForm";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ datum?: string }> }) {
  const s = getSettings();
  const today = nowIn(s.timezone).date;
  const maxDate = addDays(today, s.max_days_ahead);
  const { datum } = await searchParams;

  const hours = db().prepare("SELECT weekday, open_min, close_min FROM opening_hours ORDER BY open_min").all() as
    { weekday: number; open_min: number; close_min: number }[];
  const closedDates = new Set(
    (db().prepare("SELECT date FROM closed_dates WHERE date BETWEEN ? AND ?").all(today, maxDate) as { date: string }[]).map((r) => r.date),
  );
  const isOpen = (d: string) => !closedDates.has(d) && hours.some((h) => h.weekday === weekday(d));
  const days = Array.from({ length: Math.min(21, s.max_days_ahead + 1) }, (_, i) => addDays(today, i))
    .map((d) => ({ date: d, open: isOpen(d) }));
  const firstOpen = days.find((d) => d.open)?.date ?? today;
  const todayHours = closedDates.has(today) ? [] : hours.filter((h) => h.weekday === weekday(today));

  return (
    <main>
      <header className="hero">
        <div className="hero-inner">
          <div className="eyebrow">Rezervacija stola</div>
          <h1>{s.restaurant_name}</h1>
          <p>Odaberite dan, broj gostiju i vrijeme. Potvrdu dobivate odmah na e-mail.</p>
          <div className="hero-meta">
            <span className="pill">
              <Icon name="clock" size={14} />
              {todayHours.length ? `Danas ${todayHours.map((h) => `${fmtMin(h.open_min)}–${fmtMin(h.close_min)}`).join(", ")}` : "Danas zatvoreno"}
            </span>
            <span className="pill"><Icon name="phone" size={14} /><a href={`tel:${s.phone.replace(/\s/g, "")}`}>{s.phone}</a></span>
          </div>
        </div>
      </header>
      <section className="booking">
        <BookingForm
          days={days}
          today={today}
          maxDate={maxDate}
          maxParty={s.max_party_online}
          phone={s.phone}
          initialDate={datum && datum >= today && datum <= maxDate ? datum : firstOpen}
        />
        <p className="foot">Za grupe veće od {s.max_party_online} osoba nazovite nas na {s.phone}.</p>
      </section>
    </main>
  );
}
