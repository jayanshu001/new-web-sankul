import cron from "node-cron";
import { processDueNotifications } from "./dispatcher";
import logger from "../../utils/logger";

let started = false;
let running = false;

export function startNotificationWorker() {
  if (started) return;
  started = true;

  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      const count = await processDueNotifications();
      if (count > 0) {
        logger.info("Notification worker dispatched scheduled notifications", { count });
      }
    } catch (err) {
      logger.error("Notification worker tick failed", {
        error: (err as Error).message,
      });
    } finally {
      running = false;
    }
  });

  logger.info("Notification worker started (cron: every minute).");
}
