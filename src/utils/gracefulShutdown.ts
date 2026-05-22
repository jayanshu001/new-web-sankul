// src/utils/gracefulShutdown.ts
//
// Orchestrated shutdown on SIGTERM/SIGINT. Order matters:
//
//   1. Flip a "shutting down" flag so /readyz starts returning 503 → load
//      balancer stops sending new traffic to this pod within ~5s (one health
//      check interval).
//   2. Stop accepting new HTTP connections (server.close()), but allow
//      in-flight requests to finish for up to DRAIN_MS.
//   3. Drain the notification scheduler worker.
//   4. Close Mongo + Redis connections.
//   5. Exit 0.
//
// If anything hangs past HARD_TIMEOUT_MS, the watchdog force-exits with code
// 1 so the process supervisor (PM2/K8s) restarts us.
//
// This module is intentionally NOT a class — there's exactly one shutdown
// per process and a module-level state is the simplest correct shape.

import type { Server } from "http";
import mongoose from "mongoose";
import { redisClient } from "../config/redis";
import { shutdownNotificationScheduler } from "../admin/notification/scheduler";
import logger from "./logger";

const DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS) || 25_000;
const HARD_TIMEOUT_MS = Number(process.env.SHUTDOWN_HARD_TIMEOUT_MS) || 30_000;

let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;

/** Read-only: true once a shutdown signal has been received. Health probe
 *  reads this so /readyz starts failing immediately. */
export const isShuttingDown = (): boolean => shuttingDown;

export interface ShutdownHooks {
  httpServer?: Server;
  /** Additional teardown to run before Mongo/Redis close (e.g. websocket
   *  servers, third-party SDKs that hold connections). */
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
      // Step 1: stop accepting new connections. Existing keep-alive sockets
      // will be closed when their next request finishes (Node 18.2+).
      if (hooks.httpServer) {
        logger.info("Closing HTTP server (no new connections).");
        // Race close() with DRAIN_MS so a stuck handler can't pin us forever.
        await Promise.race([
          closeHttpServer(hooks.httpServer),
          new Promise<void>((resolve) => setTimeout(resolve, DRAIN_MS)),
        ]);
      }

      // Step 2: app-specific teardown (websockets, etc).
      if (hooks.preClose) {
        try {
          await hooks.preClose();
        } catch (err) {
          logger.warn("preClose hook failed", { err: (err as Error).message });
        }
      }

      // Step 3: drain the BullMQ worker. Its own close() waits for the
      // active job to finish (or fail) before returning.
      try {
        logger.info("Draining notification scheduler.");
        await shutdownNotificationScheduler();
      } catch (err) {
        logger.warn("Notification scheduler shutdown error", {
          err: (err as Error).message,
        });
      }

      // Step 4: close the data stores. Mongo will flush any buffered writes;
      // Redis QUIT waits for in-flight commands to finish.
      try {
        logger.info("Closing Mongo + Redis connections.");
        await Promise.allSettled([mongoose.connection.close(), redisClient.quit()]);
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
