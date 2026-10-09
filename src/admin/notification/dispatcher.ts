// Admin notifications: FCM dispatch entry points for the controller and scheduler worker.
import { AudienceFilter } from "./audience";
import {
  dispatchAudience as sqlDispatchAudience,
  dispatchScheduledById as sqlDispatchScheduledById,
} from "../../modules/admin-notification/admin-notification.service";

export interface DispatchResult {
  status: "sent" | "failed";
  recipientCount: number;
  failureCount: number;
  invalidTokensPruned: number;
  failureReason: string | null;
  isBroadcast: boolean;
  targetCustomerIds: number[];
}

/**
 * Sends via FCM and, for targeted sends, fans out per-recipient feed rows.
 * Persisting the parent notification row is the caller's responsibility.
 */
export async function dispatchAudience(
  payload: {
    title: string;
    body: string;
    titleHtml?: string | null;
    bodyHtml?: string | null;
    image?: string | null;
    type?: string;
    deepLink?: string | null;
    data?: Record<string, unknown>;
  },
  audienceFilter: AudienceFilter
): Promise<DispatchResult> {
  return sqlDispatchAudience(payload, audienceFilter);
}

/**
 * Used by the BullMQ worker. Atomically flips "scheduled" → "sent" so job
 * re-deliveries cannot double-send. A thrown error or a retryable failure
 * (isRetryableDispatchFailure) leaves the row "scheduled" so the BullMQ retry can claim
 * it again; on final failure the worker sets status="failed". Permanent failures are
 * written as "failed" at once. Returns null if the row was already claimed/cancelled.
 */
export async function dispatchScheduledById(
  notificationId: string,
  now: Date = new Date()
): Promise<DispatchResult | null> {
  // A non-numeric id has no row; treat it as already claimed (null).
  const id = Number(notificationId);
  if (Number.isInteger(id) && id > 0) {
    return sqlDispatchScheduledById(notificationId, now);
  }
  return null;
}
