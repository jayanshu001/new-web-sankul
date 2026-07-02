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
import { parseAllowedOrigins } from "./config/corsOrigins";
validateEnvOrExit();

import { createServer } from "http";
import type { Server as SocketIOServer } from "socket.io";
import type { WebSocketServer } from "ws";
import app from "./app";
import { connectPrisma } from "./config/prisma";
import logger from "./utils/logger";
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

const httpEnabled = process.env.HTTP_SERVER_ENABLED !== "false";
const workersEnabled = process.env.WORKER_ENABLED !== "false";

const bootMs = (label: string, startedAt: number) =>
  logger.info(`[boot] ${label}`, { ms: Date.now() - startedAt });

// HTTP server keep-alive tuning. Node's default keepAliveTimeout is 5s and
// headersTimeout is 60s; we set keepAliveTimeout > the typical AWS ELB / GCP
// LB idle timeout (60s) so the server keeps connections open until the LB
// closes them — never the other way around (which would surface as
// intermittent ECONNRESET on the client). headersTimeout must be strictly
// greater than keepAliveTimeout per the http module contract.
const KEEP_ALIVE_TIMEOUT_MS = Number(process.env.KEEP_ALIVE_TIMEOUT_MS) || 65_000;
const HEADERS_TIMEOUT_MS =
  Number(process.env.HEADERS_TIMEOUT_MS) || KEEP_ALIVE_TIMEOUT_MS + 5_000;

const allowedOrigins = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS,
  "http://localhost:3000,http://localhost:5173,http://localhost:5174"
);

const closeCameraIngest = async (wss: WebSocketServer): Promise<void> => {
  for (const client of wss.clients) {
    try {
      client.close();
    } catch {
      /* ignore individual client close errors */
    }
  }
  await new Promise<void>((resolve) => wss.close(() => resolve()));
};

const buildPreClose =
  (sockets?: { io?: SocketIOServer; wss?: WebSocketServer }) => async (): Promise<void> => {
    if (workersEnabled) {
      try {
        stopPlanPopularityScheduler();
      } catch (err) {
        logger.warn("[shutdown] stopPlanPopularityScheduler failed", {
          err: (err as Error).message,
        });
      }
    }
    if (sockets?.io) {
      try {
        await sockets.io.close();
      } catch (err) {
        logger.warn("[shutdown] Socket.io close failed", { err: (err as Error).message });
      }
    }
    if (sockets?.wss) {
      try {
        await closeCameraIngest(sockets.wss);
      } catch (err) {
        logger.warn("[shutdown] camera-ingest WS close failed", {
          err: (err as Error).message,
        });
      }
    }
    try {
      await closePdfBrowser();
    } catch (err) {
      logger.warn("[shutdown] PDF browser close failed", { err: (err as Error).message });
    }
  };

const startWorkers = async (): Promise<void> => {
  const t0 = Date.now();
  await initNotificationScheduler();
  bootMs("notification scheduler", t0);

  const t1 = Date.now();
  await initPdfUploadScheduler();
  bootMs("PDF upload scheduler", t1);

  const t2 = Date.now();
  initPlanPopularityScheduler();
  bootMs("plan popularity scheduler", t2);
};

const startServer = async () => {
  if (!httpEnabled && !workersEnabled) {
    logger.error(
      "[boot] FATAL: HTTP_SERVER_ENABLED=false and WORKER_ENABLED=false — nothing to run."
    );
    process.exit(1);
  }

  try {
    const tDb = Date.now();
    await connectPrisma();
    bootMs("MySQL (Prisma)", tDb);
    logger.info("[db] MySQL-only: all modules served from MySQL (Prisma).");

    if (httpEnabled) {
      const tPerm = Date.now();
      try {
        await syncPermissionCatalog();
        bootMs("permission catalog sync", tPerm);
      } catch (err) {
        logger.error("[permissions] catalog sync failed (continuing boot):", err);
      }
    }

    if (workersEnabled) {
      await startWorkers();
    } else {
      logger.info("[workers] WORKER_ENABLED=false — background schedulers skipped in this process.");
    }

    // Worker-only process: no HTTP listener, signal PM2 ready after workers are up.
    if (!httpEnabled) {
      installGracefulShutdown({ preClose: buildPreClose() });
      logger.info("[worker] Background worker process ready (no HTTP server).", {
        pid: process.pid,
        workersEnabled,
      });
      pm2Ready();
      return;
    }

    const httpServer = createServer(app);
    httpServer.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    httpServer.headersTimeout = HEADERS_TIMEOUT_MS;

    const io = initLiveChatSocket(httpServer, allowedOrigins);
    const wss = initCameraIngest(httpServer);
    initPdfProgressSocket();

    installGracefulShutdown({
      httpServer,
      preClose: buildPreClose({ io, wss }),
    });

    const tListen = Date.now();
    httpServer.listen(PORT, () => {
      bootMs("httpServer.listen", tListen);
      logger.info(`API server running at http://localhost:${PORT}`);
      logger.info(`Server Local IP: ${getLocalIpAddress()}`, {
        localurl: `http://${getLocalIpAddress()}:${PORT}`,
      });
      pm2Ready();
    });
  } catch (error) {
    logger.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
