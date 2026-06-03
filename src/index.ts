import dotenv from "dotenv";
// dotenv must load BEFORE env validation runs.
dotenv.config();

import { validateEnvOrExit } from "./config/env";
// Fail fast if JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / MONGODB_URI are
// missing. In prod, also requires ALLOWED_ORIGINS + RAZORPAY_WEBHOOK_SECRET.
validateEnvOrExit();

import { createServer } from "http";
import app from "./app";
import connectDB from "./config/db";
import { connectPrisma } from "./config/prisma";
import { hasMysqlMigrationModules } from "./config/migration";
import logger from "./utils/logger";
import { sendEmail } from "./utils/emailService";
import getLocalIpAddress from "./utils/getLocalIp";
import { pm2Ready } from "./utils/pm2Logger";
import { initNotificationScheduler } from "./admin/notification/scheduler";
import { syncPermissionCatalog } from "./admin/permission/permissions.seeder";
import { initLiveChatSocket } from "./socket/livechat.socket";
import { initCameraIngest } from "./socket/camera-ingest";
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
      logger.info(
        `[migration] MySQL modules active: ${process.env.MIGRATION_MYSQL_MODULES}`
      );
    }
    await connectDB();
    try {
      await syncPermissionCatalog();
    } catch (err) {
      logger.error("[permissions] catalog sync failed (continuing boot):", err);
    }
    await initNotificationScheduler();

    const httpServer = createServer(app);
    httpServer.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    httpServer.headersTimeout = HEADERS_TIMEOUT_MS;

    // Attach Socket.io for live class chat
    initLiveChatSocket(httpServer, allowedOrigins);

    // Attach the camera-ingest WebSocket bridge (browser camera → ffmpeg → RTMP)
    initCameraIngest(httpServer);

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
