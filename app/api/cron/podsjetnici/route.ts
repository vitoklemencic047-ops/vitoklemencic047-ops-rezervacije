import { NextResponse } from "next/server";
import { dueReminders, markReminderSent } from "@/lib/reservations";
import { sendReminder } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Pozivati periodički (npr. svakih 15 min): GET /api/cron/podsjetnici?key=CRON_SECRET
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Nedozvoljeno." }, { status: 401 });
  }
  const due = dueReminders(24);
  for (const r of due) {
    await sendReminder(r);
    markReminderSent(r.id);
  }
  return NextResponse.json({ poslano: due.length });
}
