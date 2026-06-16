import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { initializeTransaction, PLAN_AMOUNTS_KOBO } from "@/lib/billing";
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

  const amount = PLAN_AMOUNTS_KOBO[planKey];
  const reference = `codenexus_${planKey}_${user._id}_${crypto.randomBytes(8).toString("hex")}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const result = await initializeTransaction({
    email: user.email,
    amountKobo: amount,
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
