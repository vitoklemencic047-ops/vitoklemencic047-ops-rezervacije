"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

type Line = { from: "gost" | "asistent"; text: string };

const KEY = "rezervacije-chat";
const URL_RE = /(https?:\/\/[^\s)]+)/g;

function load(): { id: string | null; lines: Line[] } {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "") ?? { id: null, lines: [] };
  } catch {
    return { id: null, lines: [] };
  }
}

function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">{part.includes("/r/") ? "Pregled rezervacije" : part}</a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export default function ChatWidget({ restaurant }: { restaurant: string }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const saved = load();
    setId(saved.id);
    setLines(saved.lines);
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ id, lines })); } catch {}
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [id, lines, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    setLines((l) => [...l, { from: "gost", text: msg }]);
    setBusy(true);
    try {
      const res = await fetch("/api/asistent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ razgovor: id, poruka: msg }),
      });
      const data = await res.json();
      if (data.razgovor) setId(data.razgovor);
      setLines((l) => [...l, { from: "asistent", text: data.odgovor ?? data.error ?? "Nešto je pošlo po zlu." }]);
    } catch {
      setLines((l) => [...l, { from: "asistent", text: "Veza je prekinuta. Pokušajte ponovno." }]);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = ["Imate li stol za 2 večeras?", "Stol za 4 u subotu u 20h", "Kad radite nedjeljom?"];

  return (
    <>
      {open && (
        <div className="chat reveal" role="dialog" aria-label="Asistent za rezervacije">
          <div className="chat-head">
            <div className="chat-avatar"><Icon name="chat" size={16} /></div>
            <div style={{ flex: 1 }}>
              <div className="chat-title">{restaurant}</div>
              <div className="chat-sub">Asistent za rezervacije · odgovara odmah</div>
            </div>
            <button className="chat-x" onClick={() => setOpen(false)} aria-label="Zatvori"><Icon name="x" /></button>
          </div>
          <div className="chat-body" ref={listRef}>
            <div className="bubble asistent">Bok! Napišite za kada i za koliko osoba trebate stol, a ja ću provjeriti što je slobodno i rezervirati.</div>
            {lines.map((l, i) => (
              <div key={i} className={`bubble ${l.from}`}><Linkified text={l.text} /></div>
            ))}
            {busy && <div className="bubble asistent typing"><span /><span /><span /></div>}
            {lines.length === 0 && !busy && (
              <div className="chat-suggest">
                {suggestions.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
          </div>
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea ref={inputRef} rows={1} value={input} placeholder="Napišite poruku…" maxLength={1500}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button disabled={busy || !input.trim()} aria-label="Pošalji"><Icon name="send" size={16} /></button>
          </form>
        </div>
      )}
      <button className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? "Zatvori chat" : "Rezerviraj u chatu"}>
        <Icon name={open ? "x" : "chat"} size={20} />
        {!open && <span>Rezerviraj u chatu</span>}
      </button>
    </>
  );
}
