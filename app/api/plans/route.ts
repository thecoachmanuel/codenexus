import { NextResponse } from "next/server";
import { getPlans } from "@/lib/plans";

export async function GET() {
  try {
    const plans = await getPlans();
    return NextResponse.json({ plans });
  } catch (error) {
    console.error("[api/plans]", error);
    return NextResponse.json({ message: "Failed to fetch plans" }, { status: 500 });
  }
}
