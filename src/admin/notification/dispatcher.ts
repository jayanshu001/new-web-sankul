import mongoose from "mongoose";
import { Notification, INotification } from "../../models/system/Notification.model";
import { Customer } from "../../models/customer/Customer.model";
import { sendPush } from "../../utils/fcm";
import { resolveAudience, AudienceFilter } from "./audience";
import logger from "../../utils/logger";

export interface DispatchResult {
  status: "sent" | "failed";
  recipientCount: number;
  failureCount: number;
  invalidTokensPruned: number;
  failureReason: string | null;
  isBroadcast: boolean;
  targetCustomerIds: mongoose.Types.ObjectId[];
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
    image?: string | null;
    type?: string;
    deepLink?: string | null;
    data?: Record<string, unknown>;
  },
  audienceFilter: AudienceFilter,
  parentId?: mongoose.Types.ObjectId
): Promise<DispatchResult> {
  const resolved = await resolveAudience(audienceFilter);
  const isBroadcast = resolved.isAll;

  const tokenQuery: any = {
    "firebaseTokens.0": { $exists: true },
    isAccountDeleted: false,
    status: true,
  };
  if (!isBroadcast) tokenQuery._id = { $in: resolved.customerIds };

  const recipients = await Customer.find(tokenQuery).select("firebaseTokens").lean();
  const tokens = recipients.flatMap((r: any) =>
    Array.isArray(r.firebaseTokens) ? r.firebaseTokens.map((t: any) => t.token).filter(Boolean) : []
  );

  const sendResult = await sendPush(tokens, {
    title: payload.title,
    body: payload.body,
    image: payload.image,
    deepLink: payload.deepLink,
    data: payload.data,
  });

  const status: "sent" | "failed" =
    sendResult.skipped || sendResult.successCount > 0 ? "sent" : "failed";
  const failureReason =
    status === "failed"
      ? sendResult.skipped
        ? "FCM not configured."
        : "All sends failed."
      : null;

  // For targeted sends, fan out per-recipient feed rows so each user sees it
  // in their notification list. Skip for broadcast (single row already serves all).
  if (!isBroadcast && resolved.customerIds.length && status === "sent") {
    try {
      await Notification.insertMany(
        resolved.customerIds.map((id) => ({
          customerId: id,
          broadcast: false,
          title: payload.title,
          body: payload.body,
          image: payload.image ?? null,
          type: payload.type ?? "general",
          deepLink: payload.deepLink ?? null,
          data: payload.data ?? {},
          status: "sent",
          sentAt: new Date(),
          recipientCount: 1,
          audience: { all: false, userIds: [id] },
        }))
      );
    } catch (err) {
      logger.error("Failed to fan out per-recipient notification rows", {
        parentId: parentId?.toString(),
        error: (err as Error).message,
      });
    }
  }

  return {
    status,
    recipientCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
    invalidTokensPruned: sendResult.invalidTokens.length,
    failureReason,
    isBroadcast,
    targetCustomerIds: resolved.customerIds,
  };
}

/**
 * Cron worker entrypoint: atomically claim due scheduled notifications and dispatch them.
 * Uses findOneAndUpdate to flip status → "sent" (tentative) so concurrent workers
 * cannot pick up the same row. If dispatch fails, we restore status to "failed".
 */
export async function processDueNotifications(now: Date = new Date()): Promise<number> {
  let processed = 0;

  while (true) {
    const claimed = (await Notification.findOneAndUpdate(
      { status: "scheduled", scheduledAt: { $lte: now } },
      { $set: { status: "sent", sentAt: now } },
      { new: true, sort: { scheduledAt: 1 } }
    )) as INotification | null;

    if (!claimed) break;

    try {
      const result = await dispatchAudience(
        {
          title: claimed.title,
          body: claimed.body,
          image: claimed.image,
          type: claimed.type,
          deepLink: claimed.deepLink,
          data: claimed.data,
        },
        {
          platforms: claimed.audience?.platforms,
          courseIds: claimed.audience?.courseIds?.map((id) => id.toString()),
          userIds: claimed.audience?.userIds?.map((id) => id.toString()),
        },
        claimed._id as mongoose.Types.ObjectId
      );

      await Notification.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: result.status,
            failureReason: result.failureReason,
            recipientCount: result.recipientCount,
            sentAt: now,
          },
        }
      );
      processed++;
    } catch (err) {
      logger.error("Scheduled notification dispatch failed", {
        id: (claimed._id as mongoose.Types.ObjectId).toString(),
        error: (err as Error).message,
      });
      await Notification.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: "failed",
            failureReason: (err as Error).message,
          },
        }
      );
    }
  }

  return processed;
}
