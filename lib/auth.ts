import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "admin_session";

function sessionValue(): string {
  const pw = process.env.ADMIN_PASSWORD ?? "admin";
  return crypto.createHmac("sha256", pw).update("rezervacije-admin").digest("hex");
}

export function checkPassword(pw: string): boolean {
  const expected = Buffer.from(process.env.ADMIN_PASSWORD ?? "admin");
  const given = Buffer.from(pw);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export async function login() {
  (await cookies()).set(COOKIE, sessionValue(), {
    httpOnly: true, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https:"), path: "/", maxAge: 60 * 60 * 24 * 14,
  });
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  return (await cookies()).get(COOKIE)?.value === sessionValue();
}

export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/prijava");
}
