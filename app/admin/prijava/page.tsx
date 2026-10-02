"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export default function Login() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <main className="wrap">
      <h1>Admin prijava</h1>
      <form className="card" action={action}>
        <div className="field">
          <label htmlFor="lozinka">Lozinka</label>
          <input id="lozinka" name="lozinka" type="password" required autoFocus />
        </div>
        <button disabled={pending}>Prijava</button>
        {state?.error && <div className="msg bad">{state.error}</div>}
      </form>
    </main>
  );
}
