import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

const JWT_SECRET = process.env.JWT_SECRET!;
const ADMIN_COOKIE_NAME = "crevo_admin_token";
const MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

export interface AdminJWTPayload {
  role: "admin";
  email: string;
}

export function signAdminToken(payload: AdminJWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: MAX_AGE });
}

export function verifyAdminToken(token: string): AdminJWTPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AdminJWTPayload;
    if (payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setAdminSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function clearAdminSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE_NAME);
}

export async function getAdminSession(): Promise<AdminJWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}
