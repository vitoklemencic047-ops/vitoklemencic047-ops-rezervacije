import nodemailer from "nodemailer";
import { getSettings } from "./db";
import type { Reservation } from "./reservations";
import { normalizePhone, sendMessage } from "./sms";
import { fmtDate, fmtMin } from "./time";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

async function send(to: string, subject: string, text: string) {
  if (!process.env.SMTP_HOST) {
    console.log(`\n[e-mail] Za: ${to}\nPredmet: ${subject}\n\n${text}\n`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}

// Slanje ne smije srušiti rezervaciju, pa se greške samo bilježe
async function safeSend(to: string | null, subject: string, text: string) {
  if (!to) return;
  try {
    await send(to, subject, text);
  } catch (e) {
    console.error("Slanje e-maila nije uspjelo:", e);
  }
}

function details(r: Reservation) {
  return `${fmtDate(r.date)} u ${fmtMin(r.start_min)}, ${r.party_size} ${r.party_size === 1 ? "osoba" : "osobe/a"}`;
}

export function sendConfirmation(r: Reservation) {
  const s = getSettings();
  return safeSend(
    r.email,
    `Potvrda rezervacije: ${s.restaurant_name}`,
    `Poštovani/a ${r.name},\n\npotvrđujemo vašu rezervaciju u restoranu ${s.restaurant_name}:\n${details(r)}.\n\n` +
      `Rezervaciju možete pregledati ili otkazati ovdje:\n${appUrl()}/r/${r.token}\n\nVeselimo se vašem dolasku!`,
  );
}

// Podsjetnik se šalje na sve uključene kanale; vraća kanale na koje je stvarno otišao
export async function sendReminder(r: Reservation, hoursBefore: number): Promise<string[]> {
  const s = getSettings();
  const channels = s.reminder_channels.split(",").map((c) => c.trim().toLowerCase());
  const when = hoursBefore <= 3 ? `danas u ${fmtMin(r.start_min)}` : `${fmtDate(r.date)} u ${fmtMin(r.start_min)}`;
  const link = `${appUrl()}/r/${r.token}`;
  const sent: string[] = [];

  if (channels.includes("email") && r.email) {
    await safeSend(
      r.email,
      `Podsjetnik: rezervacija u ${s.restaurant_name}`,
      `Poštovani/a ${r.name},\n\npodsjećamo vas na rezervaciju: ${details(r)}.\n\n` +
        `Potvrdite dolazak ili otkažite jednim klikom:\n${link}\n\nAko ne možete doći, otkažite kako bi stol dobio netko drugi.`,
    );
    sent.push("email");
  }

  const phone = r.phone ? normalizePhone(r.phone, s.country_code) : null;
  const text = `${s.restaurant_name}: podsjetnik na rezervaciju ${when}, ${r.party_size} os. Potvrdi ili otkaži: ${link}`;
  for (const ch of ["whatsapp", "sms"] as const) {
    if (!channels.includes(ch) || !phone) continue;
    try {
      await sendMessage(ch, phone, text);
      sent.push(ch);
    } catch (e) {
      console.error(`Slanje (${ch}) nije uspjelo:`, e);
    }
  }
  return sent;
}

export function sendCancellation(r: Reservation) {
  const s = getSettings();
  return safeSend(
    r.email,
    `Rezervacija otkazana: ${s.restaurant_name}`,
    `Poštovani/a ${r.name},\n\nvaša rezervacija (${details(r)}) je otkazana.\n\nNadamo se da se vidimo drugom prilikom.`,
  );
}

export function sendWaitlistOffer(w: { name: string; email: string | null }, date: string) {
  const s = getSettings();
  return safeSend(
    w.email,
    `Oslobodio se stol: ${s.restaurant_name}`,
    `Poštovani/a ${w.name},\n\nza ${fmtDate(date)} oslobodio se termin. Rezervirajte prije drugih:\n${appUrl()}/?datum=${date}`,
  );
}
