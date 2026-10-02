import { NextResponse } from "next/server";
import { ask, assistantEnabled, newConversationId } from "@/lib/assistant";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!assistantEnabled()) return NextResponse.json({ error: "Asistent nije uključen." }, { status: 503 });
  const body = await req.json().catch(() => null);
  const poruka = typeof body?.poruka === "string" ? body.poruka.trim() : "";
  if (!poruka) return NextResponse.json({ error: "Prazna poruka." }, { status: 400 });
  const id = typeof body?.razgovor === "string" && /^[\w-]{8,40}$/.test(body.razgovor) && !body.razgovor.startsWith("wa-")
    ? body.razgovor
    : newConversationId();
  const reply = await ask(id, "web", poruka);
  return NextResponse.json({ razgovor: reply.conversationId, odgovor: reply.text, rezervacije: reply.reservationLinks });
}
