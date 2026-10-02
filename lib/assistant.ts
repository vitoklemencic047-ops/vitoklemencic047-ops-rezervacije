import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db, getSettings } from "./db";
import { cancelReservation } from "./cancel";
import { sendConfirmation } from "./notify";
import {
  addToWaitlist, availableSlots, BookingError, createReservation, getReservation, type Reservation,
} from "./reservations";
import { normalizePhone } from "./sms";
import { addDays, DAY_NAMES, fmtDate, fmtMin, isDate, nowIn, toMin, weekday } from "./time";

// AI asistent koji gostima odgovara na pitanja i sam upisuje rezervacije.
// Isti mozak koristi chat na stranici i WhatsApp; razlikuju se samo kanal i alati.

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;
const MAX_USER_TURNS = 40;

export type Channel = "web" | "whatsapp";
type Msg = Anthropic.Beta.BetaMessageParam;

export function assistantEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic());

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

// ---------- Razgovori ----------

type Conversation = { id: string; channel: Channel; phone: string | null; messages: Msg[]; user_turns: number };

function loadConversation(id: string): Conversation | undefined {
  const row = db().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | { id: string; channel: Channel; phone: string | null; messages: string; user_turns: number }
    | undefined;
  return row && { ...row, messages: JSON.parse(row.messages) };
}

function saveConversation(c: Conversation) {
  db()
    .prepare(
      `INSERT INTO conversations (id, channel, phone, messages, user_turns) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, user_turns = excluded.user_turns, updated_at = datetime('now')`,
    )
    .run(c.id, c.channel, c.phone, JSON.stringify(c.messages), c.user_turns);
}

export function newConversationId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

// WhatsApp: nastavlja se razgovor s istog broja ako je bio aktivan u zadnja 4 sata
export function whatsappConversationId(phone: string): string {
  const row = db()
    .prepare(
      `SELECT id FROM conversations WHERE channel = 'whatsapp' AND phone = ? AND updated_at > datetime('now', '-4 hours')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(phone) as { id: string } | undefined;
  return row?.id ?? `wa-${newConversationId()}`;
}

// ---------- Upute ----------

function systemPrompt(channel: Channel, phone: string | null): Anthropic.Beta.BetaTextBlockParam[] {
  const s = getSettings();
  const hours = db().prepare("SELECT weekday, open_min, close_min FROM opening_hours ORDER BY weekday, open_min").all() as
    { weekday: number; open_min: number; close_min: number }[];
  const hoursText = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => {
      const h = hours.filter((x) => x.weekday === d);
      return `- ${DAY_NAMES[d]}: ${h.length ? h.map((x) => `${fmtMin(x.open_min)}–${fmtMin(x.close_min)}`).join(", ") : "zatvoreno"}`;
    })
    .join("\n");
  const now = nowIn(s.timezone);

  const stable = `Ti si ljubazni asistent za rezervacije restorana "${s.restaurant_name}". Gostima pomažeš rezervirati stol, odgovaraš na pitanja o radnom vremenu i rezervacijama te ih upisuješ na listu čekanja kad nema mjesta.

Radno vrijeme:
${hoursText}

Pravila restorana:
- Online se može rezervirati za 1 do ${s.max_party_online} osoba, najkasnije ${s.min_notice} minuta unaprijed i najviše ${s.max_days_ahead} dana unaprijed. Veće grupe neka nazovu ${s.phone}.
- Stol je rezerviran ${s.duration_small} minuta za do 4 osobe, odnosno ${s.duration_large} minuta za 5 i više.
- Gost dobiva podsjetnik prije dolaska i može otkazati preko linka iz potvrde.

Kako radiš:
- Odgovaraj na jeziku na kojem ti gost piše (najčešće hrvatski), kratko i toplo, kao dobar konobar na telefonu. Bez markdowna, naslova i tablica; ovo je chat.
- Prije nego predložiš vrijeme, uvijek provjeri slobodne termine alatom provjeri_dostupnost. Nikad ne izmišljaj dostupnost.
- Ako traženo vrijeme nije slobodno, ponudi 2–3 najbliža slobodna termina tog dana ili drugi dan.
- Za rezervaciju trebaš: datum, vrijeme, broj osoba, ime i prezime te broj mobitela${channel === "web" ? " i e-mail (na njega ide potvrda)" : ""}. Pitaj samo ono što nedostaje, najviše dvije stvari odjednom.
- Prije upisa jednom ukratko ponovi detalje (dan, datum, vrijeme, broj osoba, ime) i pričekaj gostovu potvrdu. Tek tada pozovi napravi_rezervaciju.
- Nakon upisa javi da je rezervacija potvrđena i daj link za pregled i otkazivanje koji vrati alat.
- Napomene (alergije, rođendan, dječja stolica, stol na terasi) upiši u polje napomena. Ne obećavaj konkretan stol; reci da ćeš prenijeti želju.
- Ako je dan pun, ponudi listu čekanja.
- Za sve što ne znaš (jelovnik, cijene, parking, posebni događaji) reci da nemaš tu informaciju i uputi gosta na telefon ${s.phone}.
- Ne odgovaraj na teme koje nemaju veze s restoranom; ljubazno vrati razgovor na rezervaciju.`;

  const channelText = channel === "whatsapp"
    ? `Kanal: WhatsApp. Gost piše s broja ${phone}; taj broj koristi kao kontakt za rezervaciju, osim ako gost navede drugi. Gost ovdje može vidjeti i otkazati svoje rezervacije (alati moje_rezervacije i otkazi_rezervaciju); prije otkazivanja traži potvrdu.`
    : "Kanal: chat na web stranici restorana. Za otkazivanje postojeće rezervacije uputi gosta na link iz e-maila s potvrdom ili na telefon.";

  return [
    { type: "text", text: stable },
    {
      type: "text",
      text: `${channelText}\n\nSada je ${DAY_NAMES[weekday(now.date)]}, ${fmtDate(now.date)}, ${fmtMin(now.min)} (vrijeme restorana). Kad gost kaže "sutra", "u petak" i slično, sam izračunaj datum.`,
    },
  ];
}

// ---------- Alati ----------

const nullableString = { type: ["string", "null"] } as const;

function tools(channel: Channel): Anthropic.Beta.BetaTool[] {
  const list: Anthropic.Beta.BetaTool[] = [
    {
      name: "provjeri_dostupnost",
      description: "Vraća slobodne termine (vremena početka) za zadani datum i broj osoba. Pozovi prije svakog prijedloga vremena.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum u formatu YYYY-MM-DD" },
          broj_osoba: { type: "integer", description: "Broj gostiju" },
        },
        required: ["datum", "broj_osoba"],
        additionalProperties: false,
      },
    },
    {
      name: "napravi_rezervaciju",
      description: "Upisuje potvrđenu rezervaciju. Pozovi tek kad je gost potvrdio sve detalje.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          datum: { type: "string", description: "YYYY-MM-DD" },
          vrijeme: { type: "string", description: "HH:MM, mora biti jedan od slobodnih termina" },
          broj_osoba: { type: "integer" },
          ime: { type: "string", description: "Ime i prezime gosta" },
          telefon: { type: "string", description: "Broj mobitela gosta" },
          email: { ...nullableString, description: "E-mail gosta ili null" },
          napomena: { ...nullableString, description: "Posebne želje ili null" },
        },
        required: ["datum", "vrijeme", "broj_osoba", "ime", "telefon", "email", "napomena"],
        additionalProperties: false,
      },
    },
    {
      name: "upisi_na_listu_cekanja",
      description: "Upisuje gosta na listu čekanja za dan bez slobodnih termina; gost dobiva e-mail ako se oslobodi stol.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          datum: { type: "string", description: "YYYY-MM-DD" },
          broj_osoba: { type: "integer" },
          ime: { type: "string" },
          email: { type: "string" },
          telefon: nullableString,
        },
        required: ["datum", "broj_osoba", "ime", "email", "telefon"],
        additionalProperties: false,
      },
    },
  ];
  if (channel === "whatsapp") {
    list.push(
      {
        name: "moje_rezervacije",
        description: "Popis nadolazećih rezervacija vezanih uz broj s kojeg gost piše.",
        strict: true,
        input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
      {
        name: "otkazi_rezervaciju",
        description: "Otkazuje rezervaciju gosta (id iz moje_rezervacije). Pozovi tek nakon gostove potvrde.",
        strict: true,
        input_schema: {
          type: "object",
          properties: { id: { type: "integer" } },
          required: ["id"],
          additionalProperties: false,
        },
      },
    );
  }
  return list;
}

type ToolCtx = { channel: Channel; phone: string | null };

function describe(r: Reservation) {
  return { id: r.id, datum: r.date, dan: DAY_NAMES[weekday(r.date)], vrijeme: fmtMin(r.start_min), broj_osoba: r.party_size, ime: r.name };
}

function guestReservations(phone: string): Reservation[] {
  const s = getSettings();
  const today = nowIn(s.timezone).date;
  const rows = db()
    .prepare("SELECT * FROM reservations WHERE status = 'confirmed' AND date >= ? AND phone IS NOT NULL ORDER BY date, start_min")
    .all(today) as Reservation[];
  return rows.filter((r) => normalizePhone(r.phone!, s.country_code) === phone);
}

async function runTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  const s = getSettings();
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  switch (name) {
    case "provjeri_dostupnost": {
      const datum = input.datum;
      const osobe = Number(input.broj_osoba);
      if (!isDate(datum) || !Number.isInteger(osobe) || osobe < 1) return { greska: "Neispravan datum ili broj osoba." };
      if (osobe > s.max_party_online) return { greska: `Za više od ${s.max_party_online} osoba gost treba nazvati ${s.phone}.` };
      const today = nowIn(s.timezone).date;
      if (datum < today) return { greska: "Taj datum je prošao." };
      if (datum > addDays(today, s.max_days_ahead)) return { greska: `Rezervacije su otvorene najviše ${s.max_days_ahead} dana unaprijed.` };
      const termini = availableSlots(datum, osobe, { online: true }).map((x) => fmtMin(x.start_min));
      return { datum, dan: DAY_NAMES[weekday(datum)], broj_osoba: osobe, slobodni_termini: termini, napomena: termini.length ? undefined : "Nema slobodnih termina (ili je restoran zatvoren)." };
    }

    case "napravi_rezervaciju": {
      const datum = input.datum;
      if (!isDate(datum)) return { greska: "Neispravan datum." };
      let start: number;
      try {
        start = toMin(str(input.vrijeme));
      } catch {
        return { greska: "Neispravno vrijeme, koristi HH:MM." };
      }
      const ime = str(input.ime).slice(0, 100);
      const telefon = str(input.telefon).slice(0, 40);
      const email = str(input.email).slice(0, 200);
      if (!ime || !telefon) return { greska: "Nedostaje ime ili telefon." };
      if (ctx.channel === "web" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { greska: "Za chat na stranici treba ispravan e-mail." };
      try {
        const r = createReservation(
          { date: datum, start_min: start, party_size: Number(input.broj_osoba), name: ime, phone: telefon, email: email || null, note: str(input.napomena).slice(0, 500) || null },
          { online: true, source: ctx.channel === "whatsapp" ? "whatsapp" : "ai-chat" },
        );
        await sendConfirmation(r);
        return { uspjeh: true, ...describe(r), link: `${appUrl()}/r/${r.token}`, potvrda_poslana_na: r.email };
      } catch (e) {
        if (e instanceof BookingError) return { greska: e.message };
        throw e;
      }
    }

    case "upisi_na_listu_cekanja": {
      const datum = input.datum;
      const email = str(input.email);
      if (!isDate(datum) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { greska: "Treba datum i ispravan e-mail." };
      addToWaitlist({ date: datum, party_size: Number(input.broj_osoba), name: str(input.ime), email, phone: str(input.telefon) || ctx.phone || undefined });
      return { uspjeh: true };
    }

    case "moje_rezervacije": {
      if (!ctx.phone) return { greska: "Nepoznat broj." };
      return { rezervacije: guestReservations(ctx.phone).map(describe) };
    }

    case "otkazi_rezervaciju": {
      if (!ctx.phone) return { greska: "Nepoznat broj." };
      const r = getReservation(Number(input.id));
      if (!r || !guestReservations(ctx.phone).some((g) => g.id === r.id)) return { greska: "Ta rezervacija nije pronađena za ovaj broj." };
      await cancelReservation(r.id, true);
      return { uspjeh: true, otkazano: describe(r) };
    }
  }
  return { greska: `Nepoznat alat ${name}` };
}

// ---------- Glavna petlja ----------

export type AssistantReply = { conversationId: string; text: string; reservationLinks: string[] };

// Poruke istog razgovora obrađuju se jedna po jedna (npr. dvije brze WhatsApp poruke)
const queues = new Map<string, Promise<unknown>>();

export function ask(conversationId: string, channel: Channel, userText: string, phone: string | null = null): Promise<AssistantReply> {
  const prev = queues.get(conversationId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => askNow(conversationId, channel, userText, phone));
  queues.set(conversationId, next);
  next.finally(() => queues.get(conversationId) === next && queues.delete(conversationId)).catch(() => {});
  return next;
}

async function askNow(conversationId: string, channel: Channel, userText: string, phone: string | null): Promise<AssistantReply> {
  const conv = loadConversation(conversationId) ?? { id: conversationId, channel, phone, messages: [], user_turns: 0 };
  if (conv.user_turns >= MAX_USER_TURNS) {
    return { conversationId, text: `Razgovor je predug. Za daljnju pomoć nazovite nas na ${getSettings().phone}.`, reservationLinks: [] };
  }

  // Povijest se samo nadopunjuje (nikad ne mijenja), kako bi blokovi razmišljanja ostali valjani
  conv.messages.push({ role: "user", content: userText.slice(0, 1500) });
  conv.user_turns++;
  const ctx: ToolCtx = { channel, phone: conv.phone };
  const links: string[] = [];
  let text = "";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: systemPrompt(channel, conv.phone),
        tools: tools(channel),
        messages: conv.messages,
      });
      conv.messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

      if (response.stop_reason === "refusal") {
        text = `Oprostite, s tim vam ne mogu pomoći. Za rezervaciju nas slobodno nazovite na ${getSettings().phone}.`;
        break;
      }

      text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || calls.length === 0) break;

      // Svi rezultati alata idu u jednu korisničku poruku
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        try {
          const out = await runTool(call.name, call.input as Record<string, unknown>, ctx);
          const link = (out as { link?: string })?.link;
          if (link) links.push(link);
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
        } catch (e) {
          console.error(`Alat ${call.name}:`, e);
          results.push({ type: "tool_result", tool_use_id: call.id, content: "Interna greška, pokušaj ponovno ili uputi gosta na telefon.", is_error: true });
        }
      }
      conv.messages.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("Asistent:", e);
    // Neuspjeli korak se ne sprema, pa se razgovor nastavlja od zadnjeg dobrog stanja
    return { conversationId, text: `Ups, trenutno imam tehničkih poteškoća. Pokušajte ponovno za minutu ili nas nazovite na ${getSettings().phone}.`, reservationLinks: [] };
  }

  saveConversation(conv);
  return { conversationId, text: text || "Možete li ponoviti?", reservationLinks: links };
}
