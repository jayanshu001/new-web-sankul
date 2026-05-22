import mongoose from "mongoose";
import logger from "../utils/logger";
import { incrementContext } from "../utils/requestContext";

// ──────────────────────────────────────────────────────────────────────────────
// Mongoose query / aggregate timing hooks
//
// Registered globally (via mongoose.plugin) so every schema picks them up.
// We use `pre("op")` to stash a start timestamp on the query instance and
// `post("op")` to compute elapsed ms and add it to the AsyncLocalStorage
// request context. Outside a request (BullMQ worker, scripts) the
// increment is a no-op.
//
// Why a plugin rather than a global pre/post hook: mongoose's global hooks
// don't fire for query ops cleanly across all versions, but the plugin
// API (run once per schema as it's compiled) does.
// ──────────────────────────────────────────────────────────────────────────────

const QUERY_OPS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "count",
  "countDocuments",
  "estimatedDocumentCount",
  "update",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "distinct",
] as const;

const dbTimingPlugin = (schema: mongoose.Schema) => {
  for (const op of QUERY_OPS) {
    schema.pre(op as any, function (this: any) {
      this.__startedAt = process.hrtime.bigint();
    });
    schema.post(op as any, function (this: any) {
      const startedAt = this.__startedAt as bigint | undefined;
      if (startedAt === undefined) return;
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      incrementContext("dbMs", elapsedMs);
    });
  }
  // Aggregations are separate hook surface.
  schema.pre("aggregate", function (this: any) {
    this.__startedAt = process.hrtime.bigint();
  });
  schema.post("aggregate", function (this: any) {
    const startedAt = this.__startedAt as bigint | undefined;
    if (startedAt === undefined) return;
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    incrementContext("dbMs", elapsedMs);
  });
  // Document save / remove (insert path used by Model.create implicitly).
  schema.pre("save", function (this: any) {
    this.__startedAt = process.hrtime.bigint();
  });
  schema.post("save", function (this: any) {
    const startedAt = this.__startedAt as bigint | undefined;
    if (startedAt === undefined) return;
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    incrementContext("dbMs", elapsedMs);
  });
};

// Register on the default connection before any model is compiled. Models
// loaded after this point will inherit the plugin automatically.
mongoose.plugin(dbTimingPlugin);

// Pool sizing rule of thumb: `maxPoolSize × app-instance-count ≤ Mongo
// connection limit`. For Atlas M10/M20, that limit is ~500. With ~10
// PM2/cluster workers across 2 nodes (20 procs), maxPoolSize=20 yields 400
// concurrent connections — comfortable headroom. Tune via env if your
// topology differs.
//
// serverSelectionTimeoutMS: how long the driver tries to find a usable
// server before throwing. Default 30s is too forgiving for HTTP handlers —
// a 30s hang on every request when Mongo is down is worse than failing
// fast. 5s is the standard SRE value.
const MAX_POOL_SIZE = Number(process.env.MONGO_MAX_POOL_SIZE) || 20;
const MIN_POOL_SIZE = Number(process.env.MONGO_MIN_POOL_SIZE) || 2;
const SERVER_SELECTION_TIMEOUT_MS =
  Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 5_000;
const SOCKET_TIMEOUT_MS = Number(process.env.MONGO_SOCKET_TIMEOUT_MS) || 45_000;

const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState >= 1) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI as string, {
      maxPoolSize: MAX_POOL_SIZE,
      minPoolSize: MIN_POOL_SIZE,
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: SOCKET_TIMEOUT_MS,
    });
    logger.info("MongoDB connected.", {
      maxPoolSize: MAX_POOL_SIZE,
      minPoolSize: MIN_POOL_SIZE,
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });
  } catch (error) {
    logger.error(`MongoDB connection error! : ${error}`);
    throw error;
  }
};

export default connectDB;
