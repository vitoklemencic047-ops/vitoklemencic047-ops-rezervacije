"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DAY_SHORT, MONTH_SHORT, fmtShort, weekday } from "@/lib/time";
import { Icon } from "./icons";

type Slot = { min: number; vrijeme: string };
type Day = { date: string; open: boolean };

const LUNCH_END = 16 * 60;

export default function BookingForm(props: {
  days: Day[]; today: string; maxDate: string; maxParty: number; phone: string; initialDate: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(props.initialDate);
  const [party, setParty] = useState(2);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [form, setForm] = useState({ ime: "", email: "", telefon: "", napomena: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setSlot(null);
    setWaitlisted(false);
    fetch(`/api/dostupnost?datum=${date}&osobe=${party}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setSlots(d.termini ?? []))
      .catch(() => !cancelled && setSlots([]));
    return () => { cancelled = true; };
  }, [date, party]);

  useEffect(() => {
    if (slot != null) document.getElementById("podaci")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [slot]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (slot == null) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/rezervacije", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ datum: date, min: slot, osobe: party, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(`/r/${data.token}?nova=1`);
      return;
    }
    setBusy(false);
    setError(data.error ?? "Nešto je pošlo po zlu. Pokušajte ponovno.");
  }

  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/lista-cekanja", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ datum: date, osobe: party, ime: form.ime, email: form.email, telefon: form.telefon }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setWaitlisted(true);
    else setError(data.error ?? "Nešto je pošlo po zlu.");
  }

  const inList = props.days.some((d) => d.date === date);
  const groups = slots
    ? [
        { label: "Ručak", items: slots.filter((s) => s.min < LUNCH_END) },
        { label: "Večera", items: slots.filter((s) => s.min >= LUNCH_END) },
      ].filter((g) => g.items.length)
    : [];
  const chosen = slots?.find((s) => s.min === slot);

  return (
    <>
      <div className="card">
        <div className="section">
          <div className="step"><span className="step-n">1</span><h3>Koliko vas dolazi?</h3></div>
          <div className="chips" role="radiogroup" aria-label="Broj osoba">
            {Array.from({ length: props.maxParty }, (_, i) => i + 1).map((n) => (
              <button type="button" key={n} role="radio" aria-checked={party === n}
                className={`chip ${party === n ? "on" : ""}`} onClick={() => setParty(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="step"><span className="step-n">2</span><h3>Koji dan?</h3></div>
          <div className="days" role="radiogroup" aria-label="Datum">
            {props.days.map((d) => {
              const [, m, dd] = d.date.split("-").map(Number);
              return (
                <button type="button" key={d.date} role="radio" aria-checked={date === d.date} disabled={!d.open}
                  className={`day ${date === d.date ? "on" : ""}`} onClick={() => setDate(d.date)}
                  title={d.open ? fmtShort(d.date) : "Zatvoreno"}>
                  <span className="dw">{d.date === props.today ? "danas" : DAY_SHORT[weekday(d.date)]}</span>
                  <span className="dd">{dd}</span>
                  <span className="dm">{MONTH_SHORT[m - 1]}</span>
                </button>
              );
            })}
          </div>
          <div className="day-other">
            <label htmlFor="datum" style={{ margin: 0 }}>Drugi datum:</label>
            <input id="datum" type="date" value={inList ? "" : date} min={props.today} max={props.maxDate}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
            {!inList && <span className="muted">{fmtShort(date)}</span>}
          </div>
        </div>

        <div className="section">
          <div className="step"><span className="step-n">3</span><h3>U koliko sati?</h3></div>
          {slots === null && (
            <div className="slots">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" />)}</div>
          )}
          {slots?.length === 0 && (
            <div className="empty">Za {fmtShort(date)} nema slobodnih stolova za {party} {party === 1 ? "osobu" : "osobe"}. Probajte drugi dan ili se upišite na listu čekanja.</div>
          )}
          {groups.map((g) => (
            <div className="slot-group" key={g.label}>
              <div className="slot-label">{g.label}</div>
              <div className="slots">
                {g.items.map((s) => (
                  <button type="button" key={s.min} className={`slot ${slot === s.min ? "on" : ""}`} onClick={() => setSlot(s.min)}>
                    {s.vrijeme}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {chosen && (
        <form className="card reveal" id="podaci" onSubmit={submit} style={{ scrollMarginTop: 16 }}>
          <div className="step"><span className="step-n">4</span><h3>Vaši podaci</h3></div>
          <div className="summary">
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="calendar" size={16} />{fmtShort(date)}</span>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="clock" size={16} />{chosen.vrijeme}</span>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="users" size={16} />{party} {party === 1 ? "osoba" : "osobe"}</span>
          </div>
          <div className="field">
            <label htmlFor="ime">Ime i prezime</label>
            <input id="ime" required value={form.ime} onChange={set("ime")} autoComplete="name" />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="telefon">Mobitel</label>
              <input id="telefon" type="tel" required value={form.telefon} onChange={set("telefon")} autoComplete="tel" placeholder="091 234 5678" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="napomena">Napomena (nije obavezno)</label>
            <textarea id="napomena" value={form.napomena} onChange={set("napomena")} placeholder="Alergije, rođendan, dječja stolica…" />
          </div>
          <button className="block" disabled={busy}>{busy ? "Šaljem…" : "Potvrdi rezervaciju"}</button>
          {error && <div className="msg bad">{error}</div>}
          <p className="fine">Podsjetnik ćemo vam poslati prije dolaska. Rezervaciju možete otkazati jednim klikom.</p>
        </form>
      )}

      {slots?.length === 0 && (
        <form className="card reveal" onSubmit={joinWaitlist}>
          <div className="step"><Icon name="bell" /><h3>Lista čekanja</h3></div>
          {waitlisted ? (
            <div className="msg ok">Upisani ste. Javit ćemo vam e-mailom čim se oslobodi stol.</div>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Ostavite kontakt i prvi ćete saznati ako netko otkaže.</p>
              <div className="row">
                <div className="field"><label htmlFor="w-ime">Ime</label><input id="w-ime" required value={form.ime} onChange={set("ime")} /></div>
                <div className="field"><label htmlFor="w-email">E-mail</label><input id="w-email" type="email" required value={form.email} onChange={set("email")} /></div>
              </div>
              <button disabled={busy}>Upiši me</button>
              {error && <div className="msg bad">{error}</div>}
            </>
          )}
        </form>
      )}
    </>
  );
}
