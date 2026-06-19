import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import bcrypt from "bcryptjs";

// PATCH /api/user/profile — update name, email and/or password
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { name, email, currentPassword, newPassword } = await req.json();

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user)
    return NextResponse.json({ message: "User not found" }, { status: 404 });

  // --- Name / Email update ---
  if (name && name.trim()) user.name = name.trim();
  if (email && email.trim()) {
    const existing = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: user._id },
    });
    if (existing)
      return NextResponse.json(
        { message: "Email already in use" },
        { status: 409 }
      );
    user.email = email.toLowerCase().trim();
  }

  // --- Password change ---
  if (newPassword) {
    if (!currentPassword)
      return NextResponse.json(
        { message: "Current password required" },
        { status: 400 }
      );
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid)
      return NextResponse.json(
        { message: "Current password is incorrect" },
        { status: 400 }
      );
    if (newPassword.length < 8)
      return NextResponse.json(
        { message: "New password must be at least 8 characters" },
        { status: 400 }
      );
    user.password = await bcrypt.hash(newPassword, 12);
  }

  await user.save();

  return NextResponse.json({
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      credits: user.credits,
      plan: user.plan,
      imageUrl: user.imageUrl,
    },
  });
}
