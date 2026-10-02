import { requireAdmin } from "@/lib/auth";
import { db, getSettings } from "@/lib/db";
import { getFloor } from "@/lib/floor";
import { listForDate, listTables } from "@/lib/reservations";
import { addDays, fmtDate, isDate, nowIn, weekday } from "@/lib/time";
import AdminBar from "../AdminBar";
import FloorPlan from "./FloorPlan";

export const dynamic = "force-dynamic";

export default async function FloorPage({ searchParams }: { searchParams: Promise<{ datum?: string; uredi?: string }> }) {
  await requireAdmin();
  const s = getSettings();
  const now = nowIn(s.timezone);
  const { datum, uredi } = await searchParams;
  const date = isDate(datum) ? datum : now.date;
  const hours = db().prepare("SELECT MIN(open_min) a, MAX(close_min) b FROM opening_hours WHERE weekday = ?")
    .get(weekday(date)) as { a: number | null; b: number | null };
  const reservations = listForDate(date)
    .filter((r) => r.status === "confirmed" || r.status === "seated")
    .map((r) => ({
      id: r.id, name: r.name, party: r.party_size, start: r.start_min, end: r.start_min + r.duration_min,
      status: r.status, tables: r.table_ids, locked: !!r.table_locked, source: r.source, note: r.note, phone: r.phone,
    }));

  return (
    <>
      <AdminBar name={s.restaurant_name} active="tlocrt" />
      <main className="wrap wide" style={{ paddingTop: 24 }}>
        <FloorPlan
          key={`${date}-${uredi ? 1 : 0}`}
          date={date}
          dateLabel={fmtDate(date)}
          prevDate={addDays(date, -1)}
          nextDate={addDays(date, 1)}
          today={now.date}
          nowMin={now.min}
          open={hours.a ?? 12 * 60}
          close={hours.b ?? 23 * 60}
          floor={getFloor()}
          tables={listTables()}
          reservations={reservations}
          joinDistance={s.join_distance}
          combine={!!Number(s.combine_tables)}
          buffer={s.buffer}
          startEditing={!!uredi}
          importKeySet={!!process.env.IMPORT_KEY}
          appUrl={process.env.APP_URL ?? "http://localhost:3000"}
        />
      </main>
    </>
  );
}
