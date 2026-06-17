import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Setting from "@/lib/models/Setting";
import { initializeTransaction, PLAN_AMOUNTS_CENTS } from "@/lib/billing";
import { PLANS } from "@/lib/constants";
import type { Plan } from "@/types/plans";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { planKey } = await request.json();
  if (!planKey || !["starter", "pro"].includes(planKey)) {
    return NextResponse.json({ message: "Invalid plan" }, { status: 400 });
  }

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  // Fetch exchange rate or default to 1500
  const settings = await Setting.findOne();
  const exchangeRate = settings?.exchangeRate || 1500;

  // Convert USD cents to USD dollars, then to NGN, then to Kobo
  const usdDollars = PLAN_AMOUNTS_CENTS[planKey] / 100;
  const ngnAmount = usdDollars * exchangeRate;
  const koboAmount = Math.round(ngnAmount * 100);

  const reference = `crevo_${planKey}_${user._id}_${crypto.randomBytes(8).toString("hex")}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const result = await initializeTransaction({
    email: user.email,
    amount: koboAmount,
    reference,
    metadata: {
      userId: user._id.toString(),
      planKey,
      currentPlan: user.plan,
      currentCredits: user.credits,
      planCredits: PLANS[planKey as Plan]?.credits ?? 0,
    },
    callbackUrl: `${appUrl}/api/billing/verify?reference=${reference}`,
  });

  return NextResponse.json({ authorizationUrl: result.authorizationUrl });
}
