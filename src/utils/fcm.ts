// Push notifications: FCM multicast send with per-platform payloads and dead-token pruning.
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
  // HTML variants, only when the composer applied formatting. Never used for the
  // push tray; carried in `data` for the in-app inbox to render.
  titleHtml?: string | null;
  bodyHtml?: string | null;
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

// The push tray is plain text on both platforms (raw HTML tags must never leak
// into a banner); `data` carries plain + html for the in-app inbox.
function buildMessage(
  payload: FcmPayload
): Omit<admin.messaging.MulticastMessage, "tokens"> {
  const plainTitle = payload.title;
  const plainBody = payload.body;

  // The image is also set per-platform below; the explicit values win, and the
  // iOS integration asks for both.
  const notification: admin.messaging.Notification = {
    title: plainTitle,
    body: plainBody,
  };
  if (payload.image) notification.imageUrl = payload.image;

  const data: Record<string, string> = {};
  if (payload.deepLink) data.deepLink = payload.deepLink;
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      data[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  if (!("title" in data)) data.title = plainTitle;
  if (!("body" in data)) data.body = plainBody;
  if (payload.titleHtml) data.titleHtml = payload.titleHtml;
  if (payload.bodyHtml) data.bodyHtml = payload.bodyHtml;
  // iOS never exposes the image on its `notification` object, so the app reads it
  // from data. Both spellings are sent: Notifee reads `image`, the RN inbox reads
  // `imageUrl`. Every `data` value must be a plain string.
  if (payload.image) {
    data.imageUrl = payload.image;
    data.image = payload.image;
  }

  const androidNotification: admin.messaging.AndroidNotification = {
    title: plainTitle,
    body: plainBody,
  };
  if (payload.image) androidNotification.imageUrl = payload.image;

  const android: admin.messaging.AndroidConfig = { notification: androidNotification };

  // `mutableContent` lets the iOS Notification Service Extension download and
  // attach the image. Push type/priority are explicit because a push inferred as
  // `background` never wakes the extension, so the image would silently not attach.
  const apns: admin.messaging.ApnsConfig = {
    headers: { "apns-push-type": "alert", "apns-priority": "10" },
    payload: { aps: { alert: { title: plainTitle, body: plainBody } } },
  };
  if (payload.image) {
    // The field iOS reads for the tray image when backgrounded or killed.
    apns.fcmOptions = { imageUrl: payload.image };
    apns.payload!.aps.mutableContent = true;
  }

  return {
    notification,
    data: Object.keys(data).length ? data : undefined,
    android,
    apns,
  };
}

// Sends in batches of 500 and prunes tokens FCM reports invalid; skipped without Firebase.
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

  const message = buildMessage(payload);
  const messaging = admin.messaging();

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens: string[] = [];
  // Per-device error codes distinguish bad tokens from credential mismatches or a
  // missing APNs key (messaging/third-party-auth-error).
  const errorCodes: Record<string, number> = {};
  let sampleErrorMessage: string | null = null;

  for (let i = 0; i < unique.length; i += FCM_BATCH_SIZE) {
    const batch = unique.slice(i, i + FCM_BATCH_SIZE);
    try {
      // Retries cover network/5xx only; invalid-token errors arrive inside a
      // successful response, and retrying dead tokens would not help.
      const resp = await callOutbound(
        () =>
          messaging.sendEachForMulticast({
            tokens: batch,
            ...message,
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
