import mongoose from "mongoose";

export interface ISetting {
  exchangeRate: number; // NGN to USD rate
  defaultModel: string;
  proModel: string;
}

const settingSchema = new mongoose.Schema<ISetting>(
  {
    exchangeRate: { type: Number, required: true, default: 1500 },
    defaultModel: { type: String, required: true, default: "gemini-2.5-flash" },
    proModel: { type: String, required: true, default: "gemini-2.5-pro" },
  },
  { timestamps: true }
);

// Prevent mongoose from compiling the model multiple times in development
export default mongoose.models.Setting ||
  mongoose.model<ISetting>("Setting", settingSchema);
