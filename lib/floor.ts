import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

// Slika tlocrta je datoteka u mapi s bazom; podaci o njoj su u tablici settings (ključevi floor_*).
export const FLOOR_W = 1000;
const MIMES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif" };

function dataDir() {
  const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "rezervacije.db");
  return path.dirname(file);
}

function get(key: string): string | null {
  const r = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

function set(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export type Floor = { height: number; image: string | null; version: string };

export function getFloor(): Floor {
  const version = get("floor_version") ?? "0";
  return {
    height: Number(get("floor_height")) || 650,
    image: get("floor_mime") ? `/api/tlocrt?v=${version}` : null,
    version,
  };
}

export function floorImage(): { file: string; mime: string } | null {
  const mime = get("floor_mime");
  if (!mime || !MIMES[mime]) return null;
  const file = path.join(dataDir(), `tlocrt.${MIMES[mime]}`);
  return fs.existsSync(file) ? { file, mime } : null;
}

export function saveFloorImage(bytes: Buffer, mime: string, aspect: number) {
  if (!MIMES[mime]) throw new Error("Tlocrt mora biti slika (PNG, JPG, WebP ili SVG).");
  const old = floorImage();
  if (old) fs.rmSync(old.file, { force: true });
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), `tlocrt.${MIMES[mime]}`), bytes);
  set("floor_mime", mime);
  if (aspect > 0.1 && aspect < 10) set("floor_height", String(Math.round(FLOOR_W * aspect)));
  set("floor_version", String(Date.now()));
}

export function setFloorHeight(h: number) {
  if (h >= 200 && h <= 5000) set("floor_height", String(Math.round(h)));
}
