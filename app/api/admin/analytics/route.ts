import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Transaction from "@/lib/models/Transaction";
import User from "@/lib/models/User";

export async function GET(request: NextRequest) {
  // Simple admin auth check
  const authHeader = request.headers.get("authorization");
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";
  
  if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.split(" ")[1] !== expectedPassword) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. MRR (Revenue in last 30 days)
    const mrrAgg = await Transaction.aggregate([
      { $match: { status: "success", createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const mrr = mrrAgg.length > 0 ? mrrAgg[0].total : 0;

    // 2. Total Revenue (All time)
    const totalRevAgg = await Transaction.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalRevenue = totalRevAgg.length > 0 ? totalRevAgg[0].total : 0;

    // 3. Total Users
    const totalUsers = await User.countDocuments();

    // 4. User Growth (Last 30 days, grouped by day)
    const userGrowthAgg = await User.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fill in missing days for the chart
    const userGrowth = [];
    let cumulativeUsers = await User.countDocuments({ createdAt: { $lt: thirtyDaysAgo } });
    
    const datesMap = new Map();
    userGrowthAgg.forEach(entry => datesMap.set(entry._id, entry.count));

    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const newUsersThatDay = datesMap.get(dateStr) || 0;
      cumulativeUsers += newUsersThatDay;

      userGrowth.push({
        date: dateStr,
        newUsers: newUsersThatDay,
        totalUsers: cumulativeUsers
      });
    }

    return NextResponse.json({
      mrr,
      totalRevenue,
      totalUsers,
      userGrowth
    });
  } catch (error) {
    console.error("[Admin Analytics Error]", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
