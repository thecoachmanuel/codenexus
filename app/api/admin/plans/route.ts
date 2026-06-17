import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { connectDB } from "@/lib/mongodb";
import Plan from "@/lib/models/Plan";
import { getPlans } from "@/lib/plans";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const plans = await getPlans();
  return NextResponse.json({ plans });
}

export async function PUT(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { key, label, description, price, credits, features, featured } = body;

  if (!key) {
    return NextResponse.json({ message: "Plan key is required" }, { status: 400 });
  }

  await connectDB();
  const plan = await Plan.findOne({ key });
  if (!plan) {
    return NextResponse.json({ message: "Plan not found" }, { status: 404 });
  }

  plan.label = label ?? plan.label;
  plan.description = description ?? plan.description;
  plan.price = price ?? plan.price;
  plan.credits = credits ?? plan.credits;
  plan.features = features ?? plan.features;
  plan.featured = featured ?? plan.featured;

  await plan.save();

  return NextResponse.json({ plan });
}
