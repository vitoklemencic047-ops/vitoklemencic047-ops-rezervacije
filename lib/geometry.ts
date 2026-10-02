// Geometrija tlocrta (bez baze, koristi se i u pregledniku)

export type Shape = {
  x: number | null; y: number | null; w: number; h: number; rot: number; zone: string;
};

// Pravokutnik koji obuhvaća stol nakon rotacije
export function bounds(t: Shape) {
  const a = ((t.rot ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const hw = (t.w * cos + t.h * sin) / 2, hh = (t.w * sin + t.h * cos) / 2;
  const cx = (t.x ?? 0) + t.w / 2, cy = (t.y ?? 0) + t.h / 2;
  return { x1: cx - hw, x2: cx + hw, y1: cy - hh, y2: cy + hh };
}

// Susjedni stolovi (isti prostor, razmak najviše `distance`) smiju se spojiti za veću grupu
export function adjacent(a: Shape, b: Shape, distance: number): boolean {
  if (a.x == null || b.x == null || a.zone !== b.zone) return false;
  const p = bounds(a), q = bounds(b);
  const dx = Math.max(0, q.x1 - p.x2, p.x1 - q.x2);
  const dy = Math.max(0, q.y1 - p.y2, p.y1 - q.y2);
  return Math.hypot(dx, dy) <= distance;
}
