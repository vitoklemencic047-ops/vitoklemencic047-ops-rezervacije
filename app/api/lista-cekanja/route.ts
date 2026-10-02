import { NextResponse } from "next/server";
import { addToWaitlist } from "@/lib/reservations";
import { isDate } from "@/lib/time";

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const party = Number(body?.osobe);
  const name = str(body?.ime, 100);
  const email = str(body?.email);
  if (!isDate(body?.datum) || !Number.isInteger(party) || party < 1 || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Upišite datum, broj osoba, ime i ispravan e-mail." }, { status: 400 });
  }
  addToWaitlist({ date: body.datum, party_size: party, name, email, phone: str(body.telefon, 40) });
  return NextResponse.json({ ok: true }, { status: 201 });
}
