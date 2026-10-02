import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { csvToReservations, importReservation, type ExternalReservation, type ImportResult } from "@/lib/import";

// Webhook za vanjske rezervacije. Zaglavlje: Authorization: Bearer IMPORT_KEY
// Tijelo: jedna rezervacija ili niz (JSON), ili CSV (Content-Type: text/csv, ?izvor=naziv)
function authorized(req: Request): boolean {
  const key = process.env.IMPORT_KEY;
  if (!key) return false;
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(key);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Neispravan ključ (IMPORT_KEY)." }, { status: 401 });
  const source = new URL(req.url).searchParams.get("izvor") ?? "vanjski";
  let items: ExternalReservation[];
  try {
    if ((req.headers.get("content-type") ?? "").includes("text/csv")) {
      items = csvToReservations(await req.text(), source);
    } else {
      const body = await req.json();
      items = (Array.isArray(body) ? body : [body]).map((x) => ({ izvor: source, ...x }));
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Neispravan zahtjev." }, { status: 400 });
  }
  if (items.length > 1000) return NextResponse.json({ error: "Najviše 1000 rezervacija po zahtjevu." }, { status: 413 });
  const results: ImportResult[] = [];
  for (const x of items) results.push(await importReservation(x));
  const failed = results.some((r) => r.rezultat === "greška");
  return NextResponse.json({ rezultati: results }, { status: failed && results.length === 1 ? 422 : 200 });
}
