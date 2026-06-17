import mongoose from "mongoose";

export interface IPlan {
  key: string;
  label: string;
  description: string;
  price: number;
  credits: number;
  features: string[];
  featured: boolean;
}

const planSchema = new mongoose.Schema<IPlan>(
  {
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    credits: { type: Number, required: true },
    features: { type: [String], default: [] },
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Plan || mongoose.model<IPlan>("Plan", planSchema);
