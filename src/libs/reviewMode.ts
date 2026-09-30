// src/libs/reviewMode.ts
import admin from "firebase-admin";
import logger from "../utils/logger";

/**
 * Guest-mode switch, read SERVER-SIDE from the same Firebase Realtime DB node the
 * app reads (`maintain`): guest login works while `maintain.env === "staging"`.
 * Ops open/close it from the Firebase console — no `.env` flag, no restart.
 *
 * EVERY server that holds this Firebase project's service account follows the same
 * node, production included. The value is read with the Admin SDK; nothing a client
 * sends is trusted. Fails CLOSED: if Firebase cannot be read, or the listener
 * errors, guest mode is off (guest tokens answer 401).
 */
export const reviewModeFrom = (maintain: unknown): boolean => (maintain as any)?.env === "staging";

/** How long the FIRST request waits for Firebase before answering as "off". */
const FIRST_SNAPSHOT_TIMEOUT_MS = 5000;

let on = false;
let ready: Promise<void> | null = null;

/**
 * Opens the live listener; resolves once the first value (or an error / timeout) is
 * in, so the very first guest request after a restart is not answered "off" by race.
 * Own named app: utils/fcm.ts owns the default app and sets no databaseURL.
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

/** Live value of the Firebase switch. The listener starts on first use, then this is instant. */
export const isReviewModeOn = async (): Promise<boolean> => {
  await (ready ??= start());
  return on;
};
