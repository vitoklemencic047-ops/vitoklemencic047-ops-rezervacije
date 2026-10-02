"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition, type PointerEvent as RPointerEvent } from "react";
import { adjacent } from "@/lib/geometry";
import { PRIZEMLJE, PRIZEMLJE_HEIGHT } from "@/lib/layouts/prizemlje";
import type { Floor } from "@/lib/floor";
import type { Table } from "@/lib/reservations";
import { fmtMin } from "@/lib/time";
import { Icon } from "../../icons";
import {
  assignTablesAction, importCsvAction, rearrangeAction, saveLayoutAction, uploadFloorAction, type LayoutTable,
} from "./actions";

const W = 1000;

type Res = {
  id: number; name: string; party: number; start: number; end: number; status: string;
  tables: number[]; locked: boolean; source: string; note: string | null; phone: string | null;
};

type Props = {
  date: string; dateLabel: string; prevDate: string; nextDate: string; today: string; nowMin: number;
  open: number; close: number; floor: Floor; tables: Table[]; reservations: Res[];
  joinDistance: number; combine: boolean; buffer: number; startEditing: boolean; importKeySet: boolean; appUrl: string;
};

type Msg = { ok?: string; error?: string } | null;

export default function FloorPlan(p: Props) {
  const [editing, setEditing] = useState(p.startEditing);
  return (
    <>
      <div className="day-head">
        <div>
          <div className="muted small">{editing ? "Uređivanje tlocrta" : "Tlocrt i raspored gostiju"}</div>
          <h1 style={{ textTransform: "capitalize" }}>{editing ? "Tlocrt kavane" : p.dateLabel}</h1>
        </div>
        <div className="datenav">
          {!editing && (
            <>
              <Link className="btn ghost" href={`/admin/tlocrt?datum=${p.prevDate}`} aria-label="Prethodni dan"><Icon name="left" /></Link>
              <input type="date" defaultValue={p.date} aria-label="Datum"
                onChange={(e) => e.target.value && (window.location.href = `/admin/tlocrt?datum=${e.target.value}`)} />
              <Link className="btn ghost" href={`/admin/tlocrt?datum=${p.nextDate}`} aria-label="Sljedeći dan"><Icon name="right" /></Link>
              {p.date !== p.today && <Link className="btn ghost" href="/admin/tlocrt">Danas</Link>}
            </>
          )}
          <button className={editing ? "" : "ghost"} onClick={() => setEditing(!editing)}>
            {editing ? "Natrag na raspored" : "Uredi tlocrt"}
          </button>
        </div>
      </div>
      {editing ? <Editor {...p} onDone={() => setEditing(false)} /> : <Live {...p} />}
    </>
  );
}

/* ---------- Crtanje ---------- */

// Stolice oko stola, u koordinatama stola prije rotacije
function chairs(t: { x: number; y: number; w: number; h: number; shape: string; max_seats: number }) {
  const n = Math.min(t.max_seats, 24);
  const out: [number, number][] = [];
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, gap = 9;
  if (t.shape === "round") {
    const rx = t.w / 2 + gap, ry = t.h / 2 + gap;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return out;
  }
  const horiz = t.w >= t.h;
  const a = Math.ceil(n / 2), b = Math.floor(n / 2);
  const side = (count: number, first: boolean) => {
    for (let i = 0; i < count; i++) {
      const f = (i + 1) / (count + 1);
      out.push(horiz
        ? [t.x + t.w * f, first ? t.y - gap : t.y + t.h + gap]
        : [first ? t.x - gap : t.x + t.w + gap, t.y + t.h * f]);
    }
  };
  side(a, true);
  side(b, false);
  return out;
}

function TableShape({ t, className, onPointerDown, onClick, children }: {
  t: Table | LayoutTable; className: string; onPointerDown?: (e: RPointerEvent) => void; onClick?: () => void;
  children?: React.ReactNode;
}) {
  const x = t.x ?? 0, y = t.y ?? 0;
  const cx = x + t.w / 2, cy = y + t.h / 2;
  return (
    <g className={`ft ${className}`} onPointerDown={onPointerDown} onClick={onClick}>
      <g transform={`rotate(${t.rot} ${cx} ${cy})`}>
        {chairs({ ...t, x, y }).map(([a, b], i) => <circle key={i} className="ft-chair" cx={a} cy={b} r={6} />)}
        {t.shape === "round"
          ? <ellipse className="ft-top" cx={cx} cy={cy} rx={t.w / 2} ry={t.h / 2} />
          : <rect className="ft-top" x={x} y={y} width={t.w} height={t.h} rx={6} />}
      </g>
      {children}
    </g>
  );
}

function Label({ t, lines }: { t: { x: number | null; y: number | null; w: number; h: number }; lines: (string | null)[] }) {
  // Na malim stolovima drugi redak ne stane; status se vidi po boji, detalji u oblačiću
  const shown = (t.w < 50 ? lines.slice(0, 1) : lines).filter(Boolean) as string[];
  const cx = (t.x ?? 0) + t.w / 2, cy = (t.y ?? 0) + t.h / 2;
  return (
    <text className="ft-label" x={cx} y={cy - ((shown.length - 1) * 15) / 2} textAnchor="middle" dominantBaseline="middle">
      {shown.map((l, i) => <tspan key={i} x={cx} dy={i ? 15 : 0} className={i ? "ft-sub" : ""}>{l}</tspan>)}
    </text>
  );
}

function center(t: { x: number | null; y: number | null; w: number; h: number }) {
  return [(t.x ?? 0) + t.w / 2, (t.y ?? 0) + t.h / 2];
}

/* ---------- Pregled dana ---------- */

function Live(p: Props) {
  const placed = p.tables.filter((t) => t.active && t.x != null);
  const unplaced = p.tables.filter((t) => t.active && t.x == null);
  const byId = useMemo(() => new Map(p.tables.map((t) => [t.id, t])), [p.tables]);
  const step = 15;
  const startTime = p.date === p.today
    ? Math.min(p.close, Math.max(p.open, Math.floor(p.nowMin / step) * step))
    : (p.reservations[0]?.start ?? Math.max(p.open, 19 * 60));
  const [time, setTime] = useState(startTime);
  const [sel, setSel] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const selRes = p.reservations.find((r) => r.id === sel) ?? null;

  const at = (tableId: number) => p.reservations.find((r) => r.tables.includes(tableId) && r.start <= time && time < r.end);
  const next = (tableId: number) => p.reservations
    .filter((r) => r.tables.includes(tableId) && r.start > time).sort((a, b) => a.start - b.start)[0];

  const run = (fn: () => Promise<Msg>) => start(async () => setMsg(await fn()));

  const choose = (r: Res) => {
    setSel(r.id);
    setPicked(r.tables);
    setTouched(false);
    setTime(r.start);
    setMsg(null);
  };

  const clickTable = (id: number) => {
    if (!selRes) return;
    // Prvi klik zamjenjuje dosadašnje stolove, sljedeći dodaju ili miču stol (spajanje)
    if (!touched) { setTouched(true); setPicked([id]); return; }
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const unseated = p.reservations.filter((r) => r.tables.length === 0);
  const pickedSeats = picked.reduce((n, id) => n + (byId.get(id)?.max_seats ?? 0), 0);

  return (
    <>
      {p.floor.image == null && placed.length === 0 && (
        <div className="msg warn">Tlocrt još nije postavljen. Klikni <b>Uredi tlocrt</b>, učitaj sliku kavane i rasporedi stolove po njoj.</div>
      )}
      {unseated.length > 0 && (
        <div className="msg bad">
          <b>Bez stola ({unseated.length}):</b>{" "}
          {unseated.map((r) => `${fmtMin(r.start)} ${r.name} (${r.party})`).join(", ")}. Odaberi rezervaciju i klikni stolove na tlocrtu.
        </div>
      )}

      <div className="fp-layout">
        <div className="card fp-main">
          <div className="fp-time">
            <Icon name="clock" />
            <b>{fmtMin(time)}</b>
            <input type="range" min={p.open} max={p.close} step={step} value={time}
              onChange={(e) => setTime(Number(e.target.value))} aria-label="Vrijeme" />
            {p.date === p.today && <button className="ghost small" onClick={() => setTime(startTime)}>Sada</button>}
          </div>
          <svg className="fp" viewBox={`0 0 ${W} ${p.floor.height}`} role="img" aria-label="Tlocrt s rasporedom stolova">
            <rect className="fp-bg" x={0} y={0} width={W} height={p.floor.height} />
            {p.floor.image && <image href={p.floor.image} x={0} y={0} width={W} height={p.floor.height} preserveAspectRatio="xMidYMid meet" />}
            {p.reservations.filter((r) => r.tables.length > 1 && r.start <= time && time < r.end).map((r) => (
              <polyline key={r.id} className="fp-join" points={r.tables.map((id) => byId.get(id)).filter(Boolean).map((t) => center(t!).join(",")).join(" ")} />
            ))}
            {placed.map((t) => {
              const now = at(t.id);
              const nx = now ? null : next(t.id);
              const soon = nx && nx.start - time <= 60;
              const cls = [
                now ? (now.status === "seated" ? "seated" : "busy") : soon ? "soon" : "free",
                selRes?.tables.includes(t.id) ? "current" : "",
                picked.includes(t.id) && selRes ? "picked" : "",
                selRes ? "clickable" : "",
              ].join(" ");
              return (
                <TableShape key={t.id} t={t} className={cls} onClick={() => clickTable(t.id)}>
                  <title>{`${t.name} (${t.min_seats}–${t.max_seats} os.)${now ? `\n${fmtMin(now.start)}–${fmtMin(now.end)} ${now.name}, ${now.party} os.` : ""}${nx ? `\nSljedeća: ${fmtMin(nx.start)} ${nx.name}` : ""}`}</title>
                  <Label t={t} lines={[t.name, now ? `${now.name.split(" ")[0]} · ${now.party}` : nx ? `od ${fmtMin(nx.start)}` : `${t.max_seats} mj.`]} />
                </TableShape>
              );
            })}
          </svg>
          <div className="fp-legend">
            <span><i className="free" />slobodno</span>
            <span><i className="soon" />rezervacija unutar 1 h</span>
            <span><i className="busy" />rezervirano</span>
            <span><i className="seated" />gosti za stolom</span>
          </div>
          {unplaced.length > 0 && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              Nisu na tlocrtu: {unplaced.map((t) => t.name).join(", ")}. Postavi ih u uređivaču.
            </p>
          )}
        </div>

        <aside className="card fp-side">
          {selRes ? (
            <div className="fp-pick">
              <div className="muted small">{fmtMin(selRes.start)}–{fmtMin(selRes.end)} · {selRes.party} os.</div>
              <h3 style={{ margin: "2px 0 8px" }}>{selRes.name}</h3>
              {selRes.note && <div className="res-note" style={{ marginBottom: 8 }}>{selRes.note}</div>}
              <p className="small" style={{ margin: "0 0 10px" }}>
                Klikni stol na tlocrtu (više stolova za spajanje). Odabrano: <b>{picked.map((id) => byId.get(id)?.name).join(" + ") || "ništa"}</b>
                {picked.length > 0 && <> ({pickedSeats} mjesta{pickedSeats < selRes.party ? ", premalo!" : ""})</>}
              </p>
              <div className="toolbar">
                <button className="small" disabled={pending || picked.length === 0}
                  onClick={() => run(() => assignTablesAction(selRes.id, picked))}>Spremi stolove</button>
                <button className="small ghost" disabled={pending}
                  onClick={() => run(async () => { const r = await assignTablesAction(selRes.id, []); setSel(null); return r; })}>Automatski</button>
                <button className="small ghost" onClick={() => { setSel(null); setPicked([]); }}>Zatvori</button>
              </div>
            </div>
          ) : (
            <>
              <h3>Rezervacije ({p.reservations.length})</h3>
              <button className="small" style={{ width: "100%" }} disabled={pending || p.reservations.length === 0}
                onClick={() => confirm("Rasporediti sve rezervacije ovog dana iznova? Ručno odabrani stolovi ostaju.") && run(() => rearrangeAction(p.date))}>
                Rasporedi dan automatski
              </button>
            </>
          )}
          {msg?.ok && <div className="msg ok small">{msg.ok}</div>}
          {msg?.error && <div className="msg bad small">{msg.error}</div>}

          <div className="fp-list">
            {p.reservations.length === 0 && <div className="empty">Nema rezervacija.</div>}
            {p.reservations.map((r) => (
              <button key={r.id} className={`fp-item ${sel === r.id ? "on" : ""} ${r.tables.length ? "" : "warn"}`} onClick={() => choose(r)}>
                <span className="fp-item-time">{fmtMin(r.start)}</span>
                <span className="fp-item-main">
                  <b>{r.name}</b> · {r.party} os.
                  <span className="muted small" style={{ display: "block" }}>
                    {r.tables.length ? r.tables.map((id) => byId.get(id)?.name ?? "?").join(" + ") : "bez stola"}
                    {r.locked && " · ručno"}
                    {!["online", "telefon", "walk-in", "e-mail", "drugo", "asistent", "whatsapp"].includes(r.source) && ` · ${r.source}`}
                    {r.status === "seated" && " · za stolom"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      <Import {...p} />
    </>
  );
}

function Import(p: Props) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <h2>Vanjske rezervacije</h2>
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          Rezervacije iz drugih sustava upisuju se ovdje i odmah dobivaju stol. Ako mjesta nema, ostaju označene kao &quot;bez stola&quot; da ih ručno smjestiš.
          Isti zapis uvezen ponovno ne stvara duplikat nego ažurira postojeći.
        </p>
        <form className="row" style={{ alignItems: "end" }}
          action={(f) => start(async () => setMsg(await importCsvAction(f)))}>
          <div className="field"><label>CSV datoteka (Excel: Spremi kao CSV)</label><input type="file" name="datoteka" accept=".csv,text/csv" required /></div>
          <div className="field"><label>Izvor</label><input name="izvor" defaultValue="csv" /></div>
          <div className="field"><button disabled={pending} style={{ width: "100%" }}>Uvezi</button></div>
        </form>
        <p className="muted small" style={{ margin: 0 }}>Stupci: datum, vrijeme, osobe, ime (obavezno) te id, telefon, email, napomena, status.</p>
        {msg?.ok && <div className="msg ok">{msg.ok}</div>}
        {msg?.error && <div className="msg bad">{msg.error}</div>}
        <hr className="divider" />
        <b className="small">Automatski uvoz (webhook)</b>
        {p.importKeySet ? (
          <pre className="fp-code">{`POST ${p.appUrl}/api/uvoz?izvor=algebra
Authorization: Bearer <IMPORT_KEY>
Content-Type: application/json

{"id": "A-1042", "datum": "2026-10-03", "vrijeme": "19:30",
 "osobe": 6, "ime": "Ana Horvat", "telefon": "091 234 5678"}`}</pre>
        ) : (
          <p className="small" style={{ marginBottom: 0 }}>Postavi <code>IMPORT_KEY</code> u <code>.env.local</code> i vanjski sustav može slati rezervacije na <code>{p.appUrl}/api/uvoz</code>.</p>
        )}
      </div>
    </>
  );
}

/* ---------- Uređivač ---------- */

type ET = LayoutTable & { key: number };

const PRESETS: { label: string; t: Partial<LayoutTable> }[] = [
  { label: "Stol za 2", t: { w: 60, h: 60, min_seats: 1, max_seats: 2, shape: "rect" } },
  { label: "Stol za 4", t: { w: 80, h: 80, min_seats: 2, max_seats: 4, shape: "rect" } },
  { label: "Okrugli za 4", t: { w: 80, h: 80, min_seats: 2, max_seats: 4, shape: "round" } },
  { label: "Dugi za 6", t: { w: 140, h: 70, min_seats: 4, max_seats: 6, shape: "rect" } },
  { label: "Šank (barske)", t: { w: 200, h: 40, min_seats: 1, max_seats: 6, shape: "rect", combinable: false } },
];

function Editor(p: Props & { onDone: () => void }) {
  const [tables, setTables] = useState<ET[]>(() => p.tables.map((t) => ({
    key: t.id, id: t.id, name: t.name, min_seats: t.min_seats, max_seats: t.max_seats,
    x: t.x, y: t.y, w: t.w, h: t.h, rot: t.rot, shape: t.shape, zone: t.zone,
    combinable: !!t.combinable, online: !!t.online, active: !!t.active,
  })));
  const [removed, setRemoved] = useState<number[]>([]);
  const [selKey, setSelKey] = useState<number | null>(null);
  const [height, setHeight] = useState(p.floor.height);
  const [opacity, setOpacity] = useState(0.85);
  const [snap, setSnap] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: number; mode: "move" | "size"; dx: number; dy: number } | null>(null);
  const nextKey = useRef(-1);

  const sel = tables.find((t) => t.key === selKey) ?? null;
  const g = (v: number) => (snap ? Math.round(v / 5) * 5 : Math.round(v));

  const update = (key: number, patch: Partial<ET>) => {
    setTables((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));
    setDirty(true);
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const s = svg.current!;
    const pt = s.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(s.getScreenCTM()!.inverse());
  };

  const down = (t: ET, mode: "move" | "size") => (e: RPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const q = point(e);
    drag.current = mode === "move"
      ? { key: t.key, mode, dx: q.x - (t.x ?? 0), dy: q.y - (t.y ?? 0) }
      : { key: t.key, mode, dx: (t.x ?? 0), dy: (t.y ?? 0) };
    setSelKey(t.key);
    svg.current?.setPointerCapture(e.pointerId);
  };

  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const q = point(e);
    if (d.mode === "move") update(d.key, { x: g(q.x - d.dx), y: g(q.y - d.dy) });
    else update(d.key, { w: Math.max(20, g(q.x - d.dx)), h: Math.max(20, g(q.y - d.dy)) });
  };

  const up = () => { drag.current = null; };

  const add = (preset: Partial<LayoutTable>) => {
    const key = nextKey.current--;
    const t: ET = {
      id: null, name: "", min_seats: 1, max_seats: 4, x: W / 2 - 40, y: height / 2 - 40, w: 80, h: 80,
      rot: 0, shape: "rect", zone: sel?.zone ?? "", combinable: true, online: true, active: true, ...preset, key,
    };
    const base = preset.name ? preset.name.replace(/\s*\d+$/, "") : "Stol";
    let i = tables.length + 1, name = `${base} ${i}`;
    while (tables.some((o) => o.name === name)) name = `${base} ${++i}`;
    setTables((ts) => [...ts, { ...t, id: null, name }]);
    setSelKey(key);
    setDirty(true);
  };

  const remove = (t: ET) => {
    if (!confirm(`Ukloniti ${t.name}? Stol s rezervacijama bit će samo isključen.`)) return;
    setTables((ts) => ts.filter((o) => o.key !== t.key));
    if (t.id) setRemoved((r) => [...r, t.id!]);
    setSelKey(null);
    setDirty(true);
  };

  const keyDown = (e: React.KeyboardEvent) => {
    if (!sel || (e.target as HTMLElement).tagName === "INPUT") return;
    const stepPx = e.shiftKey ? 20 : 5;
    const d: Record<string, [number, number]> = { ArrowLeft: [-stepPx, 0], ArrowRight: [stepPx, 0], ArrowUp: [0, -stepPx], ArrowDown: [0, stepPx] };
    if (d[e.key]) { e.preventDefault(); update(sel.key, { x: (sel.x ?? 0) + d[e.key][0], y: (sel.y ?? 0) + d[e.key][1] }); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(sel); }
  };

  const placed = tables.filter((t) => t.x != null);
  const unplaced = tables.filter((t) => t.x == null);
  const placeAll = () => {
    let i = 0;
    setTables((ts) => ts.map((t) => {
      if (t.x != null) return t;
      const col = i % 8, row = Math.floor(i++ / 8);
      return { ...t, x: 40 + col * 115, y: 40 + row * 120 };
    }));
    setDirty(true);
  };

  // Parovi stolova koje sustav smije spojiti za veću grupu
  const joins = useMemo(() => {
    if (!p.combine) return [];
    const js: [ET, ET][] = [];
    const c = placed.filter((t) => t.combinable && t.active);
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) if (adjacent(c[i], c[j], p.joinDistance)) js.push([c[i], c[j]]);
    return js;
  }, [placed, p.combine, p.joinDistance]);

  const upload = (f: FormData) => start(async () => {
    let file = f.get("slika");
    if (file instanceof File && file.size && (file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      try {
        file = await pdfToPng(file);
        f.set("slika", file);
      } catch (e) {
        console.error("PDF tlocrt:", e);
        setMsg({ error: "PDF se ne može pročitati. Spremi tlocrt kao sliku (PNG ili JPG) i pokušaj ponovno." });
        return;
      }
    }
    if (file instanceof File && file.size) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((ok) => { img.onload = img.onerror = ok; img.src = url; });
      URL.revokeObjectURL(url);
      if (img.naturalWidth) {
        f.set("omjer", String(img.naturalHeight / img.naturalWidth));
        setHeight(Math.round((W * img.naturalHeight) / img.naturalWidth));
      }
    }
    setMsg(await uploadFloorAction(f));
  });

  // Zamjenjuje sve stolove predloškom za prizemlje (spremaju se tek na "Spremi tlocrt")
  const loadTemplate = () => {
    if (tables.length && !confirm(`Zamijeniti postojećih ${tables.length} stolova predloškom za prizemlje (${PRIZEMLJE.length} stolova)?`)) return;
    setRemoved((r) => [...r, ...tables.filter((t) => t.id).map((t) => t.id!)]);
    setTables(PRIZEMLJE.map((t) => ({
      ...t, key: nextKey.current--, id: null, rot: 0, online: true, active: true,
    })));
    if (!p.floor.image) setHeight(PRIZEMLJE_HEIGHT);
    setSelKey(null);
    setDirty(true);
  };

  const save = () => start(async () => {
    const r = await saveLayoutAction(tables.map(({ key: _k, ...t }) => t), removed, height);
    setMsg(r);
    if (r.ok) { setDirty(false); setRemoved([]); }
  });

  return (
    <>
      <div className="card fp-tools">
        <div className="toolbar">
          {PRESETS.map((pr) => (
            <button key={pr.label} className="small ghost" onClick={() => add(pr.t)}><Icon name="plus" size={14} />{pr.label}</button>
          ))}
          <span className="spacer" />
          <button className="small" disabled={pending || !dirty} onClick={save}>{dirty ? "Spremi tlocrt" : "Spremljeno"}</button>
          <button className="small ghost" onClick={() => (!dirty || confirm("Odbaciti promjene?")) && p.onDone()}>Gotovo</button>
        </div>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <form action={upload} className="toolbar">
            <input type="file" name="slika" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.pdf" aria-label="Slika tlocrta" style={{ maxWidth: 240 }} />
            <button className="small ghost" disabled={pending}>{p.floor.image ? "Zamijeni sliku" : "Učitaj sliku tlocrta"}</button>
          </form>
          {p.floor.image && (
            <label className="small fp-inline">Prozirnost slike
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </label>
          )}
          <label className="small fp-inline">Visina
            <input type="number" min={200} max={5000} step={10} value={height} style={{ width: 90 }}
              onChange={(e) => { setHeight(Number(e.target.value)); setDirty(true); }} />
          </label>
          <button className="small ghost" onClick={loadTemplate}>Predložak: prizemlje ({PRIZEMLJE.length} stolova)</button>
          <label className="small fp-inline"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Mreža</label>
        </div>
        {msg?.ok && <div className="msg ok small">{msg.ok}</div>}
        {msg?.error && <div className="msg bad small">{msg.error}</div>}
      </div>

      <div className="fp-layout">
        <div className="card fp-main" tabIndex={0} onKeyDown={keyDown}>
          <svg ref={svg} className="fp editing" viewBox={`0 0 ${W} ${height}`}
            onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={() => setSelKey(null)}>
            <defs>
              <pattern id="fp-grid" width={25} height={25} patternUnits="userSpaceOnUse">
                <path d="M25 0H0V25" fill="none" className="fp-gridline" />
              </pattern>
            </defs>
            <rect className="fp-bg" x={0} y={0} width={W} height={height} />
            {p.floor.image && <image href={p.floor.image} x={0} y={0} width={W} height={height} opacity={opacity} preserveAspectRatio="xMidYMid meet" />}
            {snap && <rect x={0} y={0} width={W} height={height} fill="url(#fp-grid)" pointerEvents="none" />}
            {joins.map(([a, b]) => (
              <line key={`${a.key}-${b.key}`} className="fp-joinable" x1={center(a)[0]} y1={center(a)[1]} x2={center(b)[0]} y2={center(b)[1]} />
            ))}
            {placed.map((t) => (
              <TableShape key={t.key} t={t} className={`edit ${t.key === selKey ? "selected" : ""} ${t.active ? "" : "inactive"}`} onPointerDown={down(t, "move")}>
                <Label t={t} lines={[t.name, `${t.min_seats}–${t.max_seats}`]} />
                {t.key === selKey && (
                  <rect className="fp-handle" x={(t.x ?? 0) + t.w - 7} y={(t.y ?? 0) + t.h - 7} width={14} height={14} rx={3}
                    onPointerDown={down(t, "size")} />
                )}
              </TableShape>
            ))}
          </svg>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Povuci stol za premještanje, kvadratić u kutu za veličinu, strelice za fino pomicanje.
            {p.combine && " Isprekidane linije pokazuju stolove koje sustav smije spojiti za veće grupe."}
          </p>
        </div>

        <aside className="card fp-side">
          {sel ? (
            <>
              <h3>{sel.name}</h3>
              <div className="field"><label>Naziv</label><input value={sel.name} onChange={(e) => update(sel.key, { name: e.target.value })} /></div>
              <div className="row2">
                <div className="field"><label>Min osoba</label><input type="number" min={1} value={sel.min_seats} onChange={(e) => update(sel.key, { min_seats: Number(e.target.value) })} /></div>
                <div className="field"><label>Max osoba</label><input type="number" min={1} value={sel.max_seats} onChange={(e) => update(sel.key, { max_seats: Number(e.target.value) })} /></div>
              </div>
              <div className="row2">
                <div className="field"><label>Oblik</label>
                  <select value={sel.shape} onChange={(e) => update(sel.key, { shape: e.target.value as "rect" | "round" })}>
                    <option value="rect">Pravokutni</option><option value="round">Okrugli</option>
                  </select>
                </div>
                <div className="field"><label>Zakret (°)</label>
                  <input type="number" step={15} value={sel.rot} onChange={(e) => update(sel.key, { rot: Number(e.target.value) })} />
                </div>
              </div>
              <div className="row2">
                <div className="field"><label>Širina</label><input type="number" min={20} value={sel.w} onChange={(e) => update(sel.key, { w: Number(e.target.value) })} /></div>
                <div className="field"><label>Dubina</label><input type="number" min={20} value={sel.h} onChange={(e) => update(sel.key, { h: Number(e.target.value) })} /></div>
              </div>
              <div className="field"><label>Prostor (npr. terasa, unutra)</label>
                <input value={sel.zone} list="fp-zones" onChange={(e) => update(sel.key, { zone: e.target.value })} />
                <datalist id="fp-zones">{[...new Set(tables.map((t) => t.zone).filter(Boolean))].map((z) => <option key={z} value={z} />)}</datalist>
              </div>
              <label className="fp-check"><input type="checkbox" checked={sel.combinable} onChange={(e) => update(sel.key, { combinable: e.target.checked })} /> Smije se spajati sa susjednim stolovima</label>
              <label className="fp-check"><input type="checkbox" checked={sel.online} onChange={(e) => update(sel.key, { online: e.target.checked })} /> Dostupan za online rezervacije</label>
              <label className="fp-check"><input type="checkbox" checked={sel.active} onChange={(e) => update(sel.key, { active: e.target.checked })} /> Aktivan</label>
              <div className="toolbar" style={{ marginTop: 12 }}>
                <button className="small ghost" onClick={() => add({ ...sel, id: null, x: (sel.x ?? 0) + 20, y: (sel.y ?? 0) + 20 })}>Kopiraj</button>
                <button className="small ghost" onClick={() => update(sel.key, { rot: (sel.rot + 90) % 360 })}>Zakreni 90°</button>
                <button className="small ghost danger" onClick={() => remove(sel)}>Ukloni</button>
              </div>
            </>
          ) : (
            <>
              <h3>Stolovi ({tables.length})</h3>
              <p className="muted small" style={{ marginTop: 0 }}>Klikni stol na tlocrtu za uređivanje. Ukupno mjesta: {tables.filter((t) => t.active).reduce((n, t) => n + t.max_seats, 0)}.</p>
              {unplaced.length > 0 && (
                <div className="msg warn small">
                  {unplaced.length} {unplaced.length === 1 ? "stol nije" : "stolova nije"} na tlocrtu: {unplaced.map((t) => t.name).join(", ")}.
                  <div style={{ marginTop: 8 }}><button className="small" onClick={placeAll}>Postavi ih na tlocrt</button></div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

// Prva stranica PDF-a (npr. arhitektonski tlocrt) pretvorena u PNG, u pregledniku.
// Legacy build jer obični traži najnovije JS značajke koje mnogi preglednici još nemaju.
async function pdfToPng(file: File): Promise<File> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, 2400 / base.width) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) throw new Error("PDF render");
  return new File([blob], file.name.replace(/\.pdf$/i, ".png"), { type: "image/png" });
}
