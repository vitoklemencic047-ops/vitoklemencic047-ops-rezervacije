import { NextResponse } from "next/server";
import { availableSlots } from "@/lib/reservations";
import { fmtMin, isDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("datum");
  const party = Number(url.searchParams.get("osobe"));
  if (!isDate(date) || !Number.isInteger(party) || party < 1) {
    return NextResponse.json({ error: "Neispravan datum ili broj osoba." }, { status: 400 });
  }
  const slots = availableSlots(date, party, { online: true }).map((s) => ({ min: s.start_min, vrijeme: fmtMin(s.start_min) }));
  return NextResponse.json({ datum: date, osobe: party, termini: slots });
}
