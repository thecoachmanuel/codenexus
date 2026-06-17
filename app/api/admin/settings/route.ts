import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { connectDB } from "@/lib/mongodb";
import Setting from "@/lib/models/Setting";

// Helper to get or create the singleton settings document
async function getOrCreateSettings() {
  await connectDB();
  let settings = await Setting.findOne();
  if (!settings) {
    settings = await Setting.create({ exchangeRate: 1500 });
  }
  return settings;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const settings = await getOrCreateSettings();
  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (typeof body.exchangeRate !== "number" || body.exchangeRate <= 0) {
    return NextResponse.json({ message: "Invalid exchange rate" }, { status: 400 });
  }

  const settings = await getOrCreateSettings();
  settings.exchangeRate = body.exchangeRate;
  await settings.save();

  return NextResponse.json({ settings });
}
