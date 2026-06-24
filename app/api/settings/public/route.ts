import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Setting from "@/lib/models/Setting";

export async function GET() {
  try {
    await connectDB();
    const setting = await Setting.findOne().lean();

    if (
      setting &&
      setting.aiSuggestions &&
      setting.aiSuggestions.length > 0 &&
      setting.aiPlaceholders &&
      setting.aiPlaceholders.length > 0
    ) {
      return NextResponse.json({
        suggestions: setting.aiSuggestions,
        placeholders: setting.aiPlaceholders,
      });
    }

    return NextResponse.json({ suggestions: null, placeholders: null });
  } catch {
    return NextResponse.json({ suggestions: null, placeholders: null });
  }
}
