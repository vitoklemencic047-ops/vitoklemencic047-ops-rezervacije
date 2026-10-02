import { getSettings } from "@/lib/db";
import { addDays, nowIn } from "@/lib/time";
import BookingForm from "./BookingForm";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ datum?: string }> }) {
  const s = getSettings();
  const today = nowIn(s.timezone).date;
  const { datum } = await searchParams;
  return (
    <main className="wrap">
      <h1>{s.restaurant_name}</h1>
      <p className="muted">Rezervirajte stol online. Za grupe veće od {s.max_party_online} osoba nazovite nas na {s.phone}.</p>
      <BookingForm
        today={today}
        maxDate={addDays(today, s.max_days_ahead)}
        maxParty={s.max_party_online}
        initialDate={datum && datum >= today ? datum : today}
      />
    </main>
  );
}
