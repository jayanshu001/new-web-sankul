/**
 * Client lecture: video lookup + entitlement checks. The controller owns encryptVideoSource (fixed video-URL contract).
 * payment_status has no column, so status=true.
 */
import { prisma } from "../../config/prisma";
import { parsePositiveInt } from "../../utils/parseId";

export const parseLecId = parsePositiveInt;

/** Any price. Caller maps null → 404 and status:false → 403. */
export const findVideo = (id: number) =>
  prisma.video.findFirst({
    where: { id },
    select: { id: true, title: true, platform: true, youtube_id: true, aws_id: true, vimeo_id: true, priceType: true, status: true, videoCategoryId: true },
  });

/**
 * There is no VideoCategory.courseId column, so membership = the video's category is in the
 * course's reachable category set (relation DAG; same resolver the heartbeat uses).
 */
export const videoBelongsToCourse = async (videoCategoryId: number | null, courseId: number): Promise<boolean> => {
  if (videoCategoryId == null) return false;
  const { reachableCategoryIds } = await import("../catalog-category-tree/category-tree.service");
  const reachable = await reachableCategoryIds("course", courseId);
  return reachable.has(videoCategoryId);
};

export const hasActiveCourseSub = async (customerId: number, courseId: number): Promise<boolean> => {
  const now = new Date();
  const sub = await prisma.packageCourseSubscription.findFirst({
    where: { customerId, courseId, status: true, endAt: { gt: now } }, select: { id: true },
  });
  return sub !== null;
};

export const hasActivePackageSub = async (customerId: number, packageId: number): Promise<boolean> => {
  const now = new Date();
  const sub = await prisma.packageCourseSubscription.findFirst({
    where: { customerId, packageId, status: true, endAt: { gt: now } }, select: { id: true },
  });
  return sub !== null;
};
