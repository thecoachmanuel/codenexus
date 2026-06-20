import mongoose from "mongoose";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("Please define the MONGODB_URI environment variable inside .env.local");
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(MONGODB_URI!);
    console.log("Connected to MongoDB.");
    
    // Clear all workspaces
    const result = await mongoose.connection.collection("workspaces").deleteMany({});
    console.log(`Deleted ${result.deletedCount} projects/workspaces.`);
    
    await mongoose.disconnect();
    console.log("Done.");
  } catch (err) {
    console.error("Error clearing workspaces:", err);
  }
}

run();
