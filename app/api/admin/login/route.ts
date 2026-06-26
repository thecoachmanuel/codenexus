import { NextRequest, NextResponse } from "next/server";
import { signAdminToken, setAdminSessionCookie } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    const expectedEmail = process.env.ADMIN_EMAIL || "johndoe@demo.com";
    const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";

    if (email !== expectedEmail || password !== expectedPassword) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    }

    const token = signAdminToken({ role: "admin", email });
    await setAdminSessionCookie(token);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
