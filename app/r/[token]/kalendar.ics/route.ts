import { getSettings } from "@/lib/db";
import { getByToken } from "@/lib/reservations";

export const dynamic = "force-dynamic";

const stamp = (date: string, min: number) =>
  `${date.replaceAll("-", "")}T${String(Math.floor(min / 60) % 24).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;
const esc = (t: string) => t.replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");

// Datoteka za dodavanje rezervacije u Google/Apple/Outlook kalendar
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = getByToken(token);
  if (!r) return new Response("Nije pronađeno", { status: 404 });
  const s = getSettings();
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/r/${r.token}`;
  const end = Math.min(r.start_min + r.duration_min, 24 * 60 - 1);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rezervacije//HR", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${r.token}@rezervacije`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;TZID=${s.timezone}:${stamp(r.date, r.start_min)}`,
    `DTEND;TZID=${s.timezone}:${stamp(r.date, end)}`,
    `SUMMARY:${esc(`Rezervacija: ${s.restaurant_name}`)}`,
    `DESCRIPTION:${esc(`${r.party_size} os. na ime ${r.name}. Pregled i otkazivanje: ${url}`)}`,
    `URL:${url}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${esc(s.restaurant_name)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="rezervacija.ics"' },
  });
}
