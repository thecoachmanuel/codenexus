import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string; // bcrypt hash
  imageUrl: string;
  credits: number;
  plan: "free" | "starter" | "pro";
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    imageUrl: { type: String, default: "" },
    credits: { type: Number, default: 10 },
    plan: { type: String, enum: ["free", "starter", "pro"], default: "free" },
  },
  { timestamps: true }
);

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export default User;
