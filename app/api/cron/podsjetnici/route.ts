import { NextResponse } from "next/server";
import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

// Podsjetnici se šalju automatski iz same aplikacije (instrumentation.ts).
// Ovaj endpoint služi za vanjski cron na platformama bez stalnog procesa (npr. Vercel):
// GET /api/cron/podsjetnici?key=CRON_SECRET
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Nedozvoljeno." }, { status: 401 });
  }
  return NextResponse.json({ poslano: await runReminders() });
}
