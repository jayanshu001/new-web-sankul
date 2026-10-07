// Graceful shutdown on SIGTERM/SIGINT. Order matters: flip the flag so /readyz returns
// 503 and the LB stops routing here, stop accepting connections (in-flight
// requests get up to DRAIN_MS), drain the BullMQ workers, then close Prisma +
// Redis. Past HARD_TIMEOUT_MS the watchdog exits 1 so PM2/K8s restarts us.

import type { Server } from "http";
import { disconnectPrisma } from "../config/prisma";
import { redisClient } from "../config/redis";
import { shutdownNotificationScheduler } from "../admin/notification/scheduler";
import { shutdownPdfUploadScheduler } from "../admin/pdfUpload/pdfUpload.scheduler";
import { shutdownExportScheduler } from "../admin/exports/export.scheduler";
import logger from "./logger";

const DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS) || 25_000;
const HARD_TIMEOUT_MS = Number(process.env.SHUTDOWN_HARD_TIMEOUT_MS) || 30_000;

let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;

/** True once a shutdown signal arrived; /readyz reads it to start failing immediately. */
export const isShuttingDown = (): boolean => shuttingDown;

export interface ShutdownHooks {
  httpServer?: Server;
  /** Teardown run before the DB/Redis close (websocket servers, SDKs holding connections). */
  preClose?: () => Promise<void>;
}

const closeHttpServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close((err) => {
      if (err) logger.warn("HTTP server close error", { err: err.message });
      resolve();
    });
  });

export const installGracefulShutdown = (hooks: ShutdownHooks): void => {
  const shutdown = async (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    logger.info(`Received ${signal}, beginning graceful shutdown.`, {
      drainMs: DRAIN_MS,
      hardTimeoutMs: HARD_TIMEOUT_MS,
    });

    const watchdog = setTimeout(() => {
      logger.error(`Graceful shutdown exceeded ${HARD_TIMEOUT_MS}ms — forcing exit.`);
      process.exit(1);
    }, HARD_TIMEOUT_MS);
    watchdog.unref?.();

    shutdownPromise = (async () => {
      // Existing keep-alive sockets close when their next request finishes (Node 18.2+).
      if (hooks.httpServer) {
        logger.info("Closing HTTP server (no new connections).");
        // Race close() with DRAIN_MS so a stuck handler can't pin us forever.
        await Promise.race([
          closeHttpServer(hooks.httpServer),
          new Promise<void>((resolve) => setTimeout(resolve, DRAIN_MS)),
        ]);
      }

      if (hooks.preClose) {
        try {
          await hooks.preClose();
        } catch (err) {
          logger.warn("preClose hook failed", { err: (err as Error).message });
        }
      }

      // Each BullMQ worker's close() waits for its active job to finish, so
      // in-flight notifications/PDF uploads/exports aren't lost.
      try {
        logger.info("Draining notification scheduler.");
        await shutdownNotificationScheduler();
      } catch (err) {
        logger.warn("Notification scheduler shutdown error", {
          err: (err as Error).message,
        });
      }

      try {
        logger.info("Draining PDF upload scheduler.");
        await shutdownPdfUploadScheduler();
      } catch (err) {
        logger.warn("PDF upload scheduler shutdown error", {
          err: (err as Error).message,
        });
      }

      try {
        logger.info("Draining report-export scheduler.");
        await shutdownExportScheduler();
      } catch (err) {
        logger.warn("Report-export scheduler shutdown error", {
          err: (err as Error).message,
        });
      }

      // Redis QUIT waits for in-flight commands to finish.
      try {
        logger.info("Closing MySQL (Prisma) + Redis connections.");
        await Promise.allSettled([redisClient.quit(), disconnectPrisma()]);
      } catch (err) {
        logger.warn("Connection close error", { err: (err as Error).message });
      }

      clearTimeout(watchdog);
      logger.info("Graceful shutdown complete.");
      process.exit(0);
    })();

    return shutdownPromise;
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};
