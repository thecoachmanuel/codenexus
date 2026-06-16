import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable");
}

// Cache the connection across hot-reloads in development
const globalForMongoose = globalThis as unknown as {
  mongooseConn: typeof mongoose | null;
  mongoosePromise: Promise<typeof mongoose> | null;
};

let cached = globalForMongoose.mongooseConn;
let promise = globalForMongoose.mongoosePromise;

export async function connectDB(): Promise<typeof mongoose> {
  if (cached) return cached;

  if (!promise) {
    promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });
    globalForMongoose.mongoosePromise = promise;
  }

  cached = await promise;
  globalForMongoose.mongooseConn = cached;
  return cached;
}
