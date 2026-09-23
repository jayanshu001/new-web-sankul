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
  // SQL row ids. Callers only read `.length`.
  targetCustomerIds: number[];
}

/**
 * Resolve the audience, send via FCM, and (for targeted sends) fan out
 * per-recipient feed rows. Returns the outcome; persisting the parent
 * notification row is the caller's responsibility.
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
 * Dispatch a single scheduled notification by id. Used by the BullMQ worker.
 * Atomically flips status "scheduled" → "sent" so re-deliveries of the same
 * job (BullMQ retry, multi-instance) cannot double-send. Throws on dispatch
 * failure so BullMQ can apply its retry policy; on final failure the caller
 * is responsible for setting status="failed".
 *
 * Returns null if the row was already claimed/cancelled (no-op).
 */
export async function dispatchScheduledById(
  notificationId: string,
  now: Date = new Date()
): Promise<DispatchResult | null> {
  // Admin-supplied scheduled ids are numeric (SQL row ids). A non-numeric id has
  // no SQL row, so there is nothing to dispatch — treat it as a no-op (null),
  // matching the "already claimed/cancelled" contract.
  const id = Number(notificationId);
  if (Number.isInteger(id) && id > 0) {
    return sqlDispatchScheduledById(notificationId, now);
  }
  return null;
}
