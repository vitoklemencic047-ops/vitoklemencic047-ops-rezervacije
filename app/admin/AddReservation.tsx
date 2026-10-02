"use client";

import { useActionState } from "react";
import { addReservationAction } from "./actions";

export default function AddReservation({ date, tables }: { date: string; tables: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(addReservationAction, null);
  return (
    <form className="card" action={action} key={state?.ok}>
      <div className="row">
        <div className="field"><label>Datum</label><input name="datum" type="date" defaultValue={date} required /></div>
        <div className="field"><label>Vrijeme</label><input name="vrijeme" type="time" step={900} defaultValue="19:00" required /></div>
        <div className="field"><label>Broj osoba</label><input name="osobe" type="number" min={1} defaultValue={2} required /></div>
        <div className="field">
          <label>Stol</label>
          <select name="stol" defaultValue="">
            <option value="">Automatski</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field"><label>Ime gosta</label><input name="ime" required /></div>
        <div className="field"><label>Telefon</label><input name="telefon" type="tel" /></div>
        <div className="field"><label>E-mail</label><input name="email" type="email" /></div>
        <div className="field">
          <label>Izvor</label>
          <select name="izvor" defaultValue="telefon">
            <option value="telefon">Telefon</option>
            <option value="walk-in">Walk-in</option>
            <option value="e-mail">E-mail</option>
            <option value="drugo">Drugo</option>
          </select>
        </div>
      </div>
      <div className="field"><label>Napomena</label><input name="napomena" /></div>
      <div className="toolbar">
        <button disabled={pending}>Upiši rezervaciju</button>
        <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, fontSize: 14 }}>
          <input type="checkbox" name="posalji" value="1" defaultChecked /> Pošalji potvrdu e-mailom
        </label>
      </div>
      {state?.error && <div className="msg bad">{state.error}</div>}
      {state?.ok && <div className="msg ok">{state.ok}</div>}
    </form>
  );
}
