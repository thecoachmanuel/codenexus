import mongoose, { Schema, Document, Model } from "mongoose";

export interface IWorkspace extends Document {
  _id: mongoose.Types.ObjectId;
  title: string | null;
  subdomain: string;
  userId: mongoose.Types.ObjectId;
  messages: unknown[];
  fileData: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>(
  {
    title: { type: String, default: null },
    subdomain: { type: String, unique: true, sparse: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    messages: { type: Schema.Types.Mixed, default: [] },
    fileData: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

const Workspace: Model<IWorkspace> =
  mongoose.models.Workspace ||
  mongoose.model<IWorkspace>("Workspace", WorkspaceSchema);

export default Workspace;
