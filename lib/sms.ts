// Slanje SMS-a i WhatsApp poruka preko Twilio REST API-ja.
// Bez TWILIO_* postavki poruke se ispisuju u konzolu.

export type Channel = "sms" | "whatsapp";

// "091 123 4567" -> "+385911234567"; broj koji već ima + ili 00 ostaje kakav jest
export function normalizePhone(raw: string, countryCode: string): string | null {
  let n = raw.replace(/[^\d+]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  else if (n.startsWith("0")) n = `+${countryCode}${n.slice(1)}`;
  else if (!n.startsWith("+")) n = `+${countryCode}${n}`;
  return /^\+\d{8,15}$/.test(n) ? n : null;
}

export async function sendMessage(channel: Channel, to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = channel === "whatsapp" ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
  if (!sid || !token || !from) {
    console.log(`\n[${channel}] Za: ${to}\n${body}\n`);
    return;
  }
  const prefix = channel === "whatsapp" ? "whatsapp:" : "";
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: prefix + to, From: prefix + from.replace(/^whatsapp:/, ""), Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
}
