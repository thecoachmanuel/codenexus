import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { verifyTransaction } from "@/lib/billing";
import { getPlanByKey } from "@/lib/plans";
import type { Plan } from "@/types/plans";

export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get("reference");
  if (!reference) {
    return NextResponse.redirect(new URL("/?billing=failed", request.url));
  }

  try {
    const result = await verifyTransaction(reference);
    if (result.status !== "success") {
      return NextResponse.redirect(new URL("/?billing=failed", request.url));
    }

    const { userId, planKey, currentPlan, currentCredits, planCredits,
            discountApplied, discountOneTimePerUser } =
      result.metadata as {
        userId: string;
        planKey: Plan;
        currentPlan: Plan;
        currentCredits: number;
        planCredits: number;
        discountApplied?: boolean;
        discountOneTimePerUser?: boolean;
      };

    await connectDB();

    const newPlanCredits = planCredits as number;
    const newCredits = currentCredits + newPlanCredits;

    const updatePayload: Record<string, unknown> = {
      plan: planKey,
      credits: newCredits,
    };

    // If one-time discount was used, record it so user pays full price next time
    if (discountApplied && discountOneTimePerUser) {
      updatePayload["$addToSet"] = { usedDiscountPlans: planKey };
    }

    await User.findByIdAndUpdate(userId, updatePayload);

    return NextResponse.redirect(new URL("/projects?billing=success", request.url));
  } catch (err) {
    console.error("[billing/verify]", err);
    return NextResponse.redirect(new URL("/?billing=error", request.url));
  }
}

