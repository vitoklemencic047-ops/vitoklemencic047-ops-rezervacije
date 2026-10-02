import { getReservation, markWaitlistNotified, setStatus, waitlistMatches } from "./reservations";
import { sendCancellation, sendWaitlistOffer } from "./notify";

// Otkazivanje oslobađa stol, pa odmah javljamo gostima s liste čekanja za taj dan
export async function cancelReservation(id: number, notifyGuest: boolean) {
  const r = getReservation(id);
  if (!r || r.status === "cancelled") return;
  setStatus(id, "cancelled");
  if (notifyGuest) await sendCancellation(r);
  for (const w of waitlistMatches(r.date)) {
    await sendWaitlistOffer(w, r.date);
    markWaitlistNotified(w.id);
  }
}
