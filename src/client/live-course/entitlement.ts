import mongoose from "mongoose";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";

// Default preview window for non-subscribers, in seconds.
export const PREVIEW_SECONDS = 180;

/**
 * Returns true if the customer holds an active, verified subscription to ANY
 * of the live courses the session belongs to. Multi-course sessions are
 * unlocked for a student as soon as they're paid up on one of them.
 */
export async function hasAccessToAnyLiveCourse(
  customerId: string | undefined,
  liveCourseIds: Array<mongoose.Types.ObjectId | string>
): Promise<boolean> {
  if (!customerId || !Array.isArray(liveCourseIds) || liveCourseIds.length === 0) return false;
  const now = new Date();
  const exists = await LiveCourseSubscription.exists({
    customerId,
    liveCourseId: { $in: liveCourseIds },
    status: true,
    paymentStatus: "verified",
    $or: [{ endAt: null }, { endAt: { $gte: now } }],
  });
  return Boolean(exists);
}
