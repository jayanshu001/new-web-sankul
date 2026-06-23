import dotenv from "dotenv";
// dotenv must load BEFORE env validation runs.
dotenv.config();

// JSON.stringify cannot serialize BigInt → "Do not know how to serialize a BigInt".
// Prisma returns BigInt for columns like ws_*.tracking (AWB) and unsigned-bigint
// ids, which can reach res.json() on raw-row endpoints (e.g. /admin/dashboard
// recent subscriptions carry PackageCourseSubscription.trackingId). Serialize all
// BigInt as strings globally so those responses are safe.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { validateEnvOrExit } from "./config/env";
// Fail fast if JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are missing (MONGODB_URI
// only required when MONGO_FALLBACK_ENABLED=true). In prod, also requires
// ALLOWED_ORIGINS + RAZORPAY_WEBHOOK_SECRET.
validateEnvOrExit();

import { createServer } from "http";
import app from "./app";
import connectDB from "./config/db";
import { connectPrisma } from "./config/prisma";
import { hasMysqlMigrationModules, isMongoFallbackEnabled } from "./config/migration";
import logger from "./utils/logger";
import { sendEmail } from "./utils/emailService";
import getLocalIpAddress from "./utils/getLocalIp";
import { pm2Ready } from "./utils/pm2Logger";
import { initNotificationScheduler } from "./admin/notification/scheduler";
import { syncPermissionCatalog } from "./admin/permission/permissions.seeder";
import { initLiveChatSocket } from "./socket/livechat.socket";
import { initCameraIngest } from "./socket/camera-ingest";
import { initPdfProgressSocket } from "./socket/pdf-progress.socket";
import { initPdfUploadScheduler } from "./admin/pdfUpload/pdfUpload.scheduler";
import { installGracefulShutdown } from "./utils/gracefulShutdown";

const PORT = process.env.PORT || 5000;

// HTTP server keep-alive tuning. Node's default keepAliveTimeout is 5s and
// headersTimeout is 60s; we set keepAliveTimeout > the typical AWS ELB / GCP
// LB idle timeout (60s) so the server keeps connections open until the LB
// closes them — never the other way around (which would surface as
// intermittent ECONNRESET on the client). headersTimeout must be strictly
// greater than keepAliveTimeout per the http module contract.
const KEEP_ALIVE_TIMEOUT_MS = Number(process.env.KEEP_ALIVE_TIMEOUT_MS) || 65_000;
const HEADERS_TIMEOUT_MS =
  Number(process.env.HEADERS_TIMEOUT_MS) || KEEP_ALIVE_TIMEOUT_MS + 5_000;

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  "http://localhost:3000,http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const startServer = async () => {
  try {
    if (hasMysqlMigrationModules()) {
      await connectPrisma();
      logger.info("[migration] MySQL-only mode: all modules served from MySQL (Prisma).");
    }
    // Mongo is now an opt-in fallback (migration complete → MySQL-only). Only
    // connect when explicitly re-enabled via MONGO_FALLBACK_ENABLED=true.
    if (isMongoFallbackEnabled()) {
      await connectDB();
      logger.info("[migration] MongoDB fallback connection ENABLED.");
    } else {
      logger.info("[migration] MongoDB fallback DISABLED — running MySQL-only (no Mongo connection).");
    }
    try {
      await syncPermissionCatalog();
    } catch (err) {
      logger.error("[permissions] catalog sync failed (continuing boot):", err);
    }
    await initNotificationScheduler();
    // BullMQ pipeline that uploads admin-supplied PDFs to Spaces and attaches
    // each to its ebook, strictly one-at-a-time, with live Socket.io progress.
    await initPdfUploadScheduler();

    const httpServer = createServer(app);
    httpServer.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    httpServer.headersTimeout = HEADERS_TIMEOUT_MS;

    // Attach Socket.io for live class chat
    initLiveChatSocket(httpServer, allowedOrigins);

    // Attach the camera-ingest WebSocket bridge (browser camera → ffmpeg → RTMP)
    initCameraIngest(httpServer);

    // Attach the admin PDF-upload progress namespace (/admin/pdf-uploads).
    // Must run AFTER initLiveChatSocket — it reuses that shared Socket.io server.
    initPdfProgressSocket();

    // Wire SIGTERM / SIGINT to the orchestrated shutdown — stops the LB
    // sending traffic via /readyz=503, drains in-flight, closes BullMQ + Mongo
    // + Redis, then exits. See utils/gracefulShutdown.ts for the full order.
    installGracefulShutdown({ httpServer });

    httpServer.listen(PORT, async () => {
      logger.info(`API server running at http://localhost:${PORT}`);
      logger.info(`Server Local IP: ${getLocalIpAddress()}`, { "localurl": `http://${getLocalIpAddress()}:${PORT}` });
      pm2Ready();
    });
  } catch (error) {
    logger.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
