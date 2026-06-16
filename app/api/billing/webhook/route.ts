import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { verifyWebhookSignature } from "@/lib/billing";
import { PLANS } from "@/lib/constants";
import type { Plan } from "@/types/plans";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature") ?? "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  try {
    await connectDB();

    // Handle successful charge / subscription renewal
    if (
      event.event === "charge.success" &&
      event.data?.status === "success"
    ) {
      const { userId, planKey } = event.data?.metadata ?? {};
      if (!userId || !planKey) return NextResponse.json({ received: true });

      const user = await User.findById(userId);
      if (!user) return NextResponse.json({ received: true });

      const planCredits = PLANS[planKey as Plan]?.credits ?? 0;
      const currentPlanCredits = PLANS[user.plan as Plan]?.credits ?? 0;
      const creditDelta = planCredits - currentPlanCredits;

      await User.findByIdAndUpdate(userId, {
        plan: planKey,
        credits:
          creditDelta > 0 ? user.credits + creditDelta : user.credits,
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[billing/webhook]", err);
    return NextResponse.json({ received: true }); // always 200 to Paystack
  }
}
