import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();

  const [totalUsers, totalProjects, planBreakdown, recentUsers] = await Promise.all([
    User.countDocuments(),
    Workspace.countDocuments(),
    User.aggregate([
      { $group: { _id: "$plan", count: { $sum: 1 } } },
    ]),
    User.find().sort({ createdAt: -1 }).limit(5).select("name email plan createdAt"),
  ]);

  const plans = { free: 0, starter: 0, pro: 0 };
  for (const p of planBreakdown) {
    if (p._id in plans) plans[p._id as keyof typeof plans] = p.count;
  }

  return NextResponse.json({
    totalUsers,
    totalProjects,
    plans,
    recentUsers,
  });
}
