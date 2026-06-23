import mongoose, { Schema, Document, Model } from "mongoose";

export interface IWorkspace extends Document {
  _id: mongoose.Types.ObjectId;
  title: string | null;
  subdomain: string;
  userId: mongoose.Types.ObjectId;
  messages: unknown[];
  fileData: unknown | null;
  vercel?: {
    projectId?: string;
    projectName?: string;
    url?: string;
    deployedAt?: Date;
  };
  errorHistory: unknown[];
  patchHistory: unknown[];
  lastSuccessfulBuild: unknown | null;
  projectSpec: unknown | null;
  currentStatus: string | null;
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
    vercel: {
      projectId: { type: String },
      projectName: { type: String },
      url: { type: String },
      deployedAt: { type: Date }
    },
    errorHistory: { type: [Schema.Types.Mixed], default: [] },
    patchHistory: { type: [Schema.Types.Mixed], default: [] },
    lastSuccessfulBuild: { type: Schema.Types.Mixed, default: null },
    projectSpec: { type: Schema.Types.Mixed, default: null },
    currentStatus: { type: String, default: null },
  },
  { timestamps: true }
);

const Workspace: Model<IWorkspace> =
  mongoose.models.Workspace ||
  mongoose.model<IWorkspace>("Workspace", WorkspaceSchema);

export default Workspace;
