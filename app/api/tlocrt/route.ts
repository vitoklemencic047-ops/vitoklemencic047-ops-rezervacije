import fs from "node:fs";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { floorImage } from "@/lib/floor";

// Slika tlocrta (samo za prijavljeno osoblje)
export async function GET() {
  if (!(await isAdmin())) return new NextResponse(null, { status: 401 });
  const img = floorImage();
  if (!img) return new NextResponse(null, { status: 404 });
  return new NextResponse(fs.readFileSync(img.file), {
    headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=31536000, immutable",
      // SVG može sadržavati skripte; ovako se ne izvršavaju ni kad se slika otvori izravno
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
