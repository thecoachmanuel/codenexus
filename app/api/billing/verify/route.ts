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

    const { userId, planKey, currentPlan, currentCredits, planCredits } =
      result.metadata as {
        userId: string;
        planKey: Plan;
        currentPlan: Plan;
        currentCredits: number;
        planCredits: number;
      };

    await connectDB();

    const existingPlan = await getPlanByKey(currentPlan);
    const existingPlanCredits = existingPlan?.credits ?? 0;
    
    const newPlanCredits = planCredits as number;
    const creditDelta = newPlanCredits - existingPlanCredits;
    const newCredits =
      creditDelta > 0 ? currentCredits + creditDelta : currentCredits;

    await User.findByIdAndUpdate(userId, {
      plan: planKey,
      credits: newCredits,
    });

    return NextResponse.redirect(new URL("/projects?billing=success", request.url));
  } catch (err) {
    console.error("[billing/verify]", err);
    return NextResponse.redirect(new URL("/?billing=error", request.url));
  }
}

