import admin from "firebase-admin";
import logger from "./logger";
import { callOutbound } from "../libs/outbound";
import { customerProfileRepository } from "../modules/customer-profile/customer-profile.repository";

const FCM_BATCH_SIZE = 500;

const INVALID_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

let initialized = false;

function initFirebase(): boolean {
  if (initialized) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    logger.warn("FIREBASE_SERVICE_ACCOUNT not set; FCM disabled.");
    return false;
  }
  try {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    logger.info("Firebase Admin initialized.");
    return true;
  } catch (err) {
    logger.error("Failed to initialize Firebase Admin", {
      error: (err as Error).message,
    });
    return false;
  }
}

export interface FcmPayload {
  title: string;
  body: string;
  image?: string | null;
  deepLink?: string | null;
  data?: Record<string, unknown>;
}

export interface FcmSendResult {
  attempted: number;
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  skipped: boolean;
}

function buildMessage(payload: FcmPayload): {
  notification: admin.messaging.Notification;
  data?: Record<string, string>;
} {
  const notification: admin.messaging.Notification = {
    title: payload.title,
    body: payload.body,
  };
  if (payload.image) notification.imageUrl = payload.image;

  const data: Record<string, string> = {};
  if (payload.deepLink) data.deepLink = payload.deepLink;
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      data[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }

  return { notification, data: Object.keys(data).length ? data : undefined };
}

export async function sendPush(
  tokens: string[],
  payload: FcmPayload
): Promise<FcmSendResult> {
  const unique = Array.from(new Set(tokens.filter(Boolean)));

  if (!initFirebase() || unique.length === 0) {
    return {
      attempted: unique.length,
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      skipped: !initialized,
    };
  }

  const { notification, data } = buildMessage(payload);
  const messaging = admin.messaging();

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens: string[] = [];
  // Aggregate per-device FCM error codes so failures are diagnosable. Without
  // this, "All sends failed." hides whether it's a bad token, a project/
  // credential mismatch (messaging/mismatched-credential, sender-id-mismatch),
  // or a missing APNs key for iOS (messaging/third-party-auth-error).
  const errorCodes: Record<string, number> = {};
  let sampleErrorMessage: string | null = null;

  for (let i = 0; i < unique.length; i += FCM_BATCH_SIZE) {
    const batch = unique.slice(i, i + FCM_BATCH_SIZE);
    try {
      // Wrapped in callOutbound: per-batch 10s timeout, 3 attempts on
      // network/5xx. Per-device invalid-token errors come back INSIDE a
      // successful response (handled below) — they don't trigger a retry,
      // which is correct: retrying with the same dead tokens won't help.
      const resp = await callOutbound(
        () =>
          messaging.sendEachForMulticast({
            tokens: batch,
            notification,
            data,
          }),
        { label: "fcm.sendMulticast", timeoutMs: 10_000, attempts: 3 }
      );
      successCount += resp.successCount;
      failureCount += resp.failureCount;
      resp.responses.forEach((r, idx) => {
        if (!r.success && r.error) {
          errorCodes[r.error.code] = (errorCodes[r.error.code] ?? 0) + 1;
          if (!sampleErrorMessage) sampleErrorMessage = r.error.message;
          if (INVALID_TOKEN_ERRORS.has(r.error.code)) {
            invalidTokens.push(batch[idx]);
          }
        }
      });
    } catch (err) {
      failureCount += batch.length;
      logger.error("FCM batch send failed after retries", {
        error: (err as Error).message,
        batchSize: batch.length,
      });
    }
  }

  if (invalidTokens.length) {
    try {
      // Clear the ws_customer.device column for any customer holding these tokens.
      await customerProfileRepository.pruneDeviceTokens(invalidTokens);
    } catch (err) {
      logger.error("Failed to prune invalid FCM tokens", {
        error: (err as Error).message,
        count: invalidTokens.length,
      });
    }
  }

  if (failureCount > 0) {
    logger.error("FCM send had failures", {
      attempted: unique.length,
      successCount,
      failureCount,
      invalidTokensPruned: invalidTokens.length,
      errorCodes,
      sampleErrorMessage,
    });
  } else {
    logger.info("FCM send ok", { attempted: unique.length, successCount });
  }

  return {
    attempted: unique.length,
    successCount,
    failureCount,
    invalidTokens,
    skipped: false,
  };
}

export function isFcmEnabled(): boolean {
  return initFirebase();
}
