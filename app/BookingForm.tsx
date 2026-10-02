"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Slot = { min: number; vrijeme: string };

export default function BookingForm(props: { today: string; maxDate: string; maxParty: number; initialDate: string }) {
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
    setBusy(false);
    if (res.ok) router.push(`/r/${data.token}?nova=1`);
    else setError(data.error ?? "Nešto je pošlo po zlu. Pokušajte ponovno.");
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

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="field">
            <label htmlFor="datum">Datum</label>
            <input id="datum" type="date" value={date} min={props.today} max={props.maxDate}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="osobe">Broj osoba</label>
            <select id="osobe" value={party} onChange={(e) => setParty(Number(e.target.value))}>
              {Array.from({ length: props.maxParty }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <label>Vrijeme</label>
        {slots === null && <p className="muted">Učitavam slobodne termine…</p>}
        {slots?.length === 0 && <p className="muted">Za taj dan nema slobodnih termina.</p>}
        {slots && slots.length > 0 && (
          <div className="slots">
            {slots.map((s) => (
              <button type="button" key={s.min} className={`slot ${slot === s.min ? "on" : ""}`} onClick={() => setSlot(s.min)}>
                {s.vrijeme}
              </button>
            ))}
          </div>
        )}
      </div>

      {slot != null && (
        <form className="card" onSubmit={submit}>
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
              <label htmlFor="telefon">Telefon</label>
              <input id="telefon" type="tel" required value={form.telefon} onChange={set("telefon")} autoComplete="tel" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="napomena">Napomena (alergije, prigoda, dječja stolica…)</label>
            <textarea id="napomena" value={form.napomena} onChange={set("napomena")} />
          </div>
          <button disabled={busy}>{busy ? "Šaljem…" : "Potvrdi rezervaciju"}</button>
          {error && <div className="msg bad">{error}</div>}
        </form>
      )}

      {slots?.length === 0 && (
        <form className="card" onSubmit={joinWaitlist}>
          <h2 style={{ marginTop: 0 }}>Lista čekanja</h2>
          {waitlisted ? (
            <div className="msg ok">Upisani ste. Javit ćemo vam e-mailom ako se oslobodi stol.</div>
          ) : (
            <>
              <p className="muted">Ostavite kontakt i javit ćemo vam ako se taj dan oslobodi stol.</p>
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
