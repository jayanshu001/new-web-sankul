// Review mode: server-side Firebase `maintain.env` switch that gates guest mode.
import admin from "firebase-admin";
import logger from "../utils/logger";

/**
 * Guest mode is on while Firebase RTDB `maintain.env === "staging"`, read
 * server-side with the Admin SDK (never trust a client value). Every server on this
 * Firebase project follows it, production included. Fails closed: if Firebase
 * cannot be read, guest mode is off.
 */
export const reviewModeFrom = (maintain: unknown): boolean => (maintain as any)?.env === "staging";

/** How long the FIRST request waits for Firebase before answering as "off". */
const FIRST_SNAPSHOT_TIMEOUT_MS = 5000;

let on = false;
let ready: Promise<void> | null = null;

/**
 * Resolves on the first value (or error/timeout) so the first guest request after
 * a restart isn't answered "off" by race. Uses its own named app because
 * utils/fcm.ts owns the default app and sets no databaseURL.
 */
const start = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, FIRST_SNAPSHOT_TIMEOUT_MS).unref();
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "");
      const databaseURL = process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}.firebaseio.com`;
      const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL }, "review-mode");
      app.database().ref("maintain").on(
        "value",
        (snap) => {
          const next = reviewModeFrom(snap.val());
          if (next !== on) logger.info("reviewMode: guest mode switched", { on: next });
          on = next;
          resolve();
        },
        (err) => {
          on = false;
          logger.error("reviewMode: Firebase listener failed; guest mode off", { error: err.message });
          resolve();
        }
      );
    } catch (err) {
      logger.error("reviewMode: cannot read Firebase `maintain`; guest mode off", { error: (err as Error).message });
      resolve();
    }
  });

/** The listener starts on first use; later calls are instant. */
export const isReviewModeOn = async (): Promise<boolean> => {
  await (ready ??= start());
  return on;
};
