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
import { connectPrisma } from "./config/prisma";
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
import {
  initPlanPopularityScheduler,
  stopPlanPopularityScheduler,
} from "./modules/plan-popularity/plan-popularity.scheduler";
import { closePdfBrowser } from "./libs/core/generate";
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
    await connectPrisma();
    logger.info("[db] MySQL-only: all modules served from MySQL (Prisma).");
    try {
      await syncPermissionCatalog();
    } catch (err) {
      logger.error("[permissions] catalog sync failed (continuing boot):", err);
    }
    // Background workers (notification dispatch, PDF-upload pipeline, plan-popularity
    // recompute). Gated so a horizontally-scaled deploy can run them in ONE dedicated
    // worker process instead of every API replica (which would duplicate FCM sends and
    // defeat the single-flight PDF design). Defaults to ENABLED so existing
    // single-process deploys are unaffected; set WORKER_ENABLED=false on API-only replicas.
    const workersEnabled = process.env.WORKER_ENABLED !== "false";
    if (workersEnabled) {
      await initNotificationScheduler();
      // BullMQ pipeline that uploads admin-supplied PDFs to Spaces and attaches
      // each to its ebook, strictly one-at-a-time, with live Socket.io progress.
      await initPdfUploadScheduler();
      // Periodic recompute of the "Most Popular" pricing-plan flags (sales-driven).
      initPlanPopularityScheduler();
    } else {
      logger.info("[workers] WORKER_ENABLED=false — background schedulers skipped in this process.");
    }

    const httpServer = createServer(app);
    httpServer.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    httpServer.headersTimeout = HEADERS_TIMEOUT_MS;

    // Attach Socket.io for live class chat (handle retained for graceful drain)
    const io = initLiveChatSocket(httpServer, allowedOrigins);

    // Attach the camera-ingest WebSocket bridge (browser camera → ffmpeg → RTMP)
    const wss = initCameraIngest(httpServer);

    // Attach the admin PDF-upload progress namespace (/admin/pdf-uploads).
    // Must run AFTER initLiveChatSocket — it reuses that shared Socket.io server.
    initPdfProgressSocket();

    // Wire SIGTERM / SIGINT to the orchestrated shutdown — stops the LB
    // sending traffic via /readyz=503, drains in-flight, closes BullMQ +
    // Redis, then exits. See utils/gracefulShutdown.ts for the full order.
    // preClose explicitly drains the socket servers (so upgraded WS connections
    // don't linger through the deploy) and stops the plan-popularity cron.
    installGracefulShutdown({
      httpServer,
      preClose: async () => {
        if (workersEnabled) {
          try {
            stopPlanPopularityScheduler();
          } catch (err) {
            logger.warn("[shutdown] stopPlanPopularityScheduler failed", { err: (err as Error).message });
          }
        }
        try {
          await io.close();
        } catch (err) {
          logger.warn("[shutdown] Socket.io close failed", { err: (err as Error).message });
        }
        try {
          for (const client of wss.clients) {
            try {
              client.close();
            } catch {
              /* ignore individual client close errors */
            }
          }
          await new Promise<void>((resolve) => wss.close(() => resolve()));
        } catch (err) {
          logger.warn("[shutdown] camera-ingest WS close failed", { err: (err as Error).message });
        }
        try {
          await closePdfBrowser();
        } catch (err) {
          logger.warn("[shutdown] PDF browser close failed", { err: (err as Error).message });
        }
      },
    });

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
