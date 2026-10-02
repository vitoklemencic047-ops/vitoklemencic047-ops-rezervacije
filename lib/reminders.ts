import { getSettings } from "./db";
import { sendReminder } from "./notify";
import { markReminders, minutesUntil, pendingReminders } from "./reservations";

let running = false;

// Šalje podsjetnike kojima je došlo vrijeme. Ako su oba podsjetnika dospjela odjednom
// (npr. server nije radio), šalje se samo jedan, bliži dolasku.
export async function runReminders(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const s = getSettings();
    const h1 = s.reminder1_hours * 60;
    const h2 = s.reminder2_hours * 60;
    let count = 0;
    for (const r of pendingReminders()) {
      const until = minutesUntil(r, s.timezone);
      if (until <= 0) continue;
      const due2 = h2 > 0 && !r.reminder2_sent && until <= h2;
      const due1 = h1 > 0 && !r.reminder_sent && until <= h1;
      if (!due1 && !due2) continue;
      await sendReminder(r, Math.ceil(until / 60));
      markReminders(r.id, true, due2);
      count++;
    }
    return count;
  } finally {
    running = false;
  }
}
