import Link from "next/link";
import { Icon } from "../icons";
import { logoutAction } from "./actions";

export default function AdminBar({ name, active }: { name: string; active: "rezervacije" | "postavke" }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand"><span className="brand-mark">{name.trim()[0]?.toUpperCase() ?? "R"}</span>{name}</div>
        <nav className="tabs">
          <Link className={`tab ${active === "rezervacije" ? "on" : ""}`} href="/admin">Rezervacije</Link>
          <Link className={`tab ${active === "postavke" ? "on" : ""}`} href="/admin/postavke">Postavke</Link>
          <Link className="tab" href="/" target="_blank">Javna stranica <Icon name="external" size={12} /></Link>
        </nav>
        <div className="spacer" />
        <form action={logoutAction}><button className="ghost small"><Icon name="logout" size={14} />Odjava</button></form>
      </div>
    </header>
  );
}
