import crypto from "node:crypto";
import { after } from "next/server";
import { ask, assistantEnabled, whatsappConversationId } from "@/lib/assistant";
import { getSettings } from "@/lib/db";
import { normalizePhone, sendMessage } from "@/lib/sms";

export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Twilio potpisuje svaki webhook: HMAC-SHA1(URL + sortirani parametri) s auth tokenom
function validSignature(req: Request, params: URLSearchParams): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  const url = `${process.env.APP_URL ?? ""}/api/whatsapp`;
  const data = url + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
  const expected = crypto.createHmac("sha1", token).update(data).digest("base64");
  const given = req.headers.get("x-twilio-signature") ?? "";
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Twilio WhatsApp webhook ("A message comes in"): https://tvoja-domena/api/whatsapp
export async function POST(req: Request) {
  const params = new URLSearchParams(await req.text());
  if (!validSignature(req, params)) return new Response("Nevaljan potpis", { status: 403 });

  const from = (params.get("From") ?? "").replace(/^whatsapp:/, "");
  const text = (params.get("Body") ?? "").trim();
  const phone = normalizePhone(from, getSettings().country_code);
  if (phone && text && assistantEnabled()) {
    // Twilio čeka odgovor najviše 15 s, pa se odgovara odmah, a poruka šalje kad je asistent gotov
    after(async () => {
      const reply = await ask(whatsappConversationId(phone), "whatsapp", text, phone);
      await sendMessage("whatsapp", phone, reply.text).catch((e) => console.error("WhatsApp odgovor:", e));
    });
  }
  return new Response(EMPTY_TWIML, { headers: { "content-type": "text/xml" } });
}
