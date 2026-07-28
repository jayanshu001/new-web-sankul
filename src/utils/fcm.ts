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
  // Rich (HTML) variants, present only when the composer applied real formatting.
  // NOT used for the push tray on either platform — both Android and iOS show the
  // plain title/body first. The HTML is carried in `data` (and persisted on the
  // row) so the in-app inbox can render the formatted version when opened.
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

// Build the multicast. The push TRAY is PLAIN on BOTH platforms (Android + iOS
// show plain text first — raw <b>/<p> tags must never leak into a banner):
//   • top-level notification → PLAIN.
//   • android config         → PLAIN alert.
//   • apns config            → PLAIN alert + fcmOptions.imageUrl + mutable-content
//                              so the iOS Notification Service Extension can
//                              download and attach the image to the banner.
//   • data                   → carries plain + html; the in-app inbox uses the
//                              html variant to render rich text when the
//                              notification is opened. The tray never reads it.
function buildMessage(
  payload: FcmPayload
): Omit<admin.messaging.MulticastMessage, "tokens"> {
  const plainTitle = payload.title;
  const plainBody = payload.body;

  // Top-level `imageUrl` (serialized as `notification.image`) is the generic
  // field FCM mirrors into whichever platform blocks it can. We ALSO set the
  // image explicitly per-platform below (android.notification.imageUrl +
  // apns.fcmOptions.imageUrl) — the explicit values win, and belt-and-braces is
  // what the iOS integration doc asks for.
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
  // Plain always available in data; html only when the composer formatted it —
  // consumed by the in-app inbox, not the push tray.
  if (!("title" in data)) data.title = plainTitle;
  if (!("body" in data)) data.body = plainBody;
  if (payload.titleHtml) data.titleHtml = payload.titleHtml;
  if (payload.bodyHtml) data.bodyHtml = payload.bodyHtml;
  // Flat, platform-neutral image keys. iOS never exposes the image on its
  // `notification` object (that object is built from `aps.alert`, which carries
  // only title/body/subtitle) — so the app reads the URL from here. Both
  // spellings are sent because the foreground handlers differ per platform
  // (Notifee reads `image`, the RN inbox reads `imageUrl`); every `data` value
  // is a plain string, never a nested object.
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

  // `mutableContent` is REQUIRED for an image: it is what lets the app's
  // Notification Service Extension intercept the push, download the URL and
  // attach it. Without the extension iOS still delivers the payload, it just
  // renders a text-only banner.
  // `apns-push-type: alert` + `apns-priority: 10` are stated explicitly rather
  // than left to APNs inference: a push that gets classified as `background`
  // never wakes the Notification Service Extension, so the image would silently
  // never attach.
  const apns: admin.messaging.ApnsConfig = {
    headers: { "apns-push-type": "alert", "apns-priority": "10" },
    payload: { aps: { alert: { title: plainTitle, body: plainBody } } },
  };
  if (payload.image) {
    // Serialized as `apns.fcm_options.image` — THE field iOS reads for the tray
    // image when the app is backgrounded or killed.
    apns.fcmOptions = { imageUrl: payload.image };
    // Serialized as `aps.mutable-content: 1`.
    apns.payload!.aps.mutableContent = true;
  }

  return {
    notification,
    data: Object.keys(data).length ? data : undefined,
    android,
    apns,
  };
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

  const message = buildMessage(payload);
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
