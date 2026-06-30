/**
 * Client lecture (video-URL) endpoint — SQL branch for GET /client/courses/lecture.
 * Gated behind `isMysqlModule("client-lecture")`. Returns the SAME encrypted
 * shape as the Mongo path (the controller owns encryptVideoSource — DB-agnostic).
 *
 * Reads ws_video + ws_video_category (course-membership check) + ws_package_course_subscription
 * (entitlement). Ids are SQL ints. payment_status has no SQL column → status=true.
 */
import { prisma } from "../../config/prisma";

export const CLIENT_LECTURE_MODULE = "client-lecture";
export const isClientLectureMysql = (): boolean => true;

export const parseLecId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export type LectureVideo = {
  id: number; title: string; platform: string;
  youtube_id: string | null; aws_id: string | null; vimeo_id: string | null;
  priceType: string; videoCategoryId: number | null;
};

/** Fetch a live video by id (any price). null → 404, status:false → 403 handled by caller. */
export const findVideo = (id: number) =>
  prisma.video.findFirst({
    where: { id },
    select: { id: true, title: true, platform: true, youtube_id: true, aws_id: true, vimeo_id: true, priceType: true, status: true, videoCategoryId: true },
  });

/**
 * Does the video's category belong to the given course? SQL has no
 * VideoCategory.courseId column (Course↔category is via Course.videoCategoryId +
 * the relation DAG), so membership = the video's category is in the course's
 * reachable category set (same resolver the heartbeat uses).
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
