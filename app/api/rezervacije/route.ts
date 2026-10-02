import { NextResponse } from "next/server";
import { BookingError, createReservation } from "@/lib/reservations";
import { sendConfirmation } from "@/lib/notify";
import { isDate } from "@/lib/time";

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Neispravan zahtjev." }, { status: 400 });

  const date = body.datum;
  const start = Number(body.min);
  const party = Number(body.osobe);
  const name = str(body.ime, 100);
  const email = str(body.email, 200);
  const phone = str(body.telefon, 40);

  if (!isDate(date) || !Number.isInteger(start) || !Number.isInteger(party) || party < 1) {
    return NextResponse.json({ error: "Neispravan termin." }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "Upišite ime." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Upišite ispravan e-mail." }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "Upišite broj telefona." }, { status: 400 });

  try {
    const r = createReservation(
      { date, start_min: start, party_size: party, name, email, phone, note: str(body.napomena, 500) },
      { online: true, source: "online" },
    );
    await sendConfirmation(r);
    return NextResponse.json({ token: r.token }, { status: 201 });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
