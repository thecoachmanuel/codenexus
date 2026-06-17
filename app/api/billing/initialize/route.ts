import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Setting from "@/lib/models/Setting";
import { initializeTransaction } from "@/lib/billing";
import { getPlanByKey } from "@/lib/plans";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { planKey } = await request.json();
  if (!planKey) {
    return NextResponse.json({ message: "Invalid plan" }, { status: 400 });
  }

  await connectDB();

  const selectedPlan = await getPlanByKey(planKey);
  if (!selectedPlan || selectedPlan.price <= 0) {
    return NextResponse.json({ message: "Invalid or free plan selected" }, { status: 400 });
  }

  const user = await User.findById(session.userId);
  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  // Determine effective price after discount
  let effectivePrice = selectedPlan.price;
  let discountApplied = false;

  if (selectedPlan.discountPercent > 0) {
    const alreadyUsedDiscount = user.usedDiscountPlans?.includes(planKey);
    // Apply discount if: no one-time restriction, OR one-time but user hasn't used it yet
    if (!selectedPlan.discountOneTimePerUser || !alreadyUsedDiscount) {
      effectivePrice = selectedPlan.price * (1 - selectedPlan.discountPercent / 100);
      discountApplied = true;
    }
  }

  // Fetch exchange rate or default to 1500
  const settings = await Setting.findOne();
  const exchangeRate = settings?.exchangeRate || 1500;

  // Convert USD dollars to NGN, then to Kobo
  const ngnAmount = effectivePrice * exchangeRate;
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
      planCredits: selectedPlan.credits,
      discountApplied,
      discountOneTimePerUser: selectedPlan.discountOneTimePerUser,
    },
    callbackUrl: `${appUrl}/api/billing/verify?reference=${reference}`,
  });

  return NextResponse.json({ authorizationUrl: result.authorizationUrl });
}
