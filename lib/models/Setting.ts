import mongoose from "mongoose";

export interface ISetting {
  exchangeRate: number; // NGN to USD rate
}

const settingSchema = new mongoose.Schema<ISetting>(
  {
    exchangeRate: { type: Number, required: true, default: 1500 },
  },
  { timestamps: true }
);

// Prevent mongoose from compiling the model multiple times in development
export default mongoose.models.Setting ||
  mongoose.model<ISetting>("Setting", settingSchema);
