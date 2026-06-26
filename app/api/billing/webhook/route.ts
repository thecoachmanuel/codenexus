import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Transaction from "@/lib/models/Transaction";
import { verifyWebhookSignature } from "@/lib/billing";
import { getPlanByKey } from "@/lib/plans";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature") ?? "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  try {
    await connectDB();

    const data = event.data ?? {};
    const reference = data.reference;
    const amount = data.amount;
    const currency = data.currency;
    const status = data.status;
    const { userId, planKey, discountApplied, discountOneTimePerUser } = data.metadata ?? {};

    // Log the transaction in the database
    if (reference && userId) {
      // Upsert transaction to avoid duplicates on retries
      await Transaction.findOneAndUpdate(
        { reference },
        {
          userId,
          amount,
          currency,
          reference,
          status,
          planKey,
          metadata: data,
        },
        { upsert: true, new: true }
      );
    }

    // Handle successful charge / subscription renewal
    if (
      event.event === "charge.success" &&
      status === "success"
    ) {
      if (!userId || !planKey) return NextResponse.json({ received: true });

      const user = await User.findById(userId);
      if (!user) return NextResponse.json({ received: true });

      const newPlan = await getPlanByKey(planKey);
      const planCredits = newPlan?.credits ?? 0;

      const updatePayload: Record<string, unknown> = {
        plan: planKey,
        credits: Number(user.credits) + Number(planCredits),
      };

      if (discountApplied && discountOneTimePerUser) {
        updatePayload["$addToSet"] = { usedDiscountPlans: planKey };
      }

      await User.findByIdAndUpdate(userId, updatePayload);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[billing/webhook]", err);
    return NextResponse.json({ received: true }); // always 200 to Paystack
  }
}
