"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export default function Login() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <main className="login">
      <form className="card" action={action}>
        <h1 style={{ marginBottom: 4 }}>Prijava</h1>
        <p className="muted" style={{ marginTop: 0 }}>Upravljanje rezervacijama</p>
        <div className="field">
          <label htmlFor="lozinka">Lozinka</label>
          <input id="lozinka" name="lozinka" type="password" required autoFocus />
        </div>
        <button className="block" disabled={pending}>Prijava</button>
        {state?.error && <div className="msg bad">{state.error}</div>}
      </form>
    </main>
  );
}
