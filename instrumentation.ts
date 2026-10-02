// Pokreće slanje podsjetnika svakih 5 minuta dok aplikacija radi.
// Isključi s DISABLE_REMINDER_LOOP=1 ako koristiš vanjski cron.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_REMINDER_LOOP === "1") return;
  const { runReminders } = await import("./lib/reminders");
  const tick = () => runReminders().catch((e) => console.error("Podsjetnici:", e));
  setTimeout(tick, 10_000);
  setInterval(tick, Number(process.env.REMINDER_INTERVAL_MS ?? 5 * 60_000));
}
