import { Request, Response } from "express";
import { Types } from "mongoose";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { generateToken, generateKey, generateVector, encrypt } from "../../utils/videoEncryption";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { lectureQuerySchema } from "./course.validation";

async function hasActiveCourseSubscription(userId: string, courseId: string): Promise<boolean> {
  const now = new Date();
  const sub = await PackageCourseSubscription.findOne({
    customerId: new Types.ObjectId(userId),
    courseId: new Types.ObjectId(courseId),
    status: true,
    endAt: { $gt: now },
  }).select("_id");
  return sub !== null;
}

async function hasActivePackageSubscription(userId: string, packageId: string): Promise<boolean> {
  const now = new Date();
  const sub = await PackageCourseSubscription.findOne({
    customerId: new Types.ObjectId(userId),
    packageId: new Types.ObjectId(packageId),
    status: true,
    endAt: { $gt: now },
  }).select("_id");
  return sub !== null;
}

function encryptVideoSource(video: {
  platform: "youtube" | "aws" | "vimeo";
  youtube_id?: string;
  aws_id?: string;
  vimeo_id?: string;
}) {
  const token = generateToken(16);
  const key = generateKey(token);
  const vector = generateVector(token);

  const sourceId =
    video.platform === "youtube"
      ? video.youtube_id
      : video.platform === "aws"
      ? video.aws_id
      : video.vimeo_id;

  const videoURL = sourceId ? encrypt(sourceId, key, vector) : "";

  return { token, videoURL };
}

export const getLectureHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;

  try {
    if (!userId) return failure(res, "Unauthorized request.", 401);

    const parsed = lectureQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }

    const { id: videoId, type } = parsed.data;
    const courseId = parsed.data.course;
    const packageId = parsed.data.package;

    if (type === "course" && !courseId) {
      return failure(res, "course param is required when type is course", 400);
    }
    if (type === "package" && !packageId) {
      return failure(res, "package param is required when type is package", 400);
    }

    const video = await Video.findById(videoId).lean();
    if (!video) {
      return failure(res, "Lecture not found", 404);
    }
    if (!video.status) {
      return failure(res, "Lecture is not available", 403);
    }

    // Verify the video belongs to the requested course/package via its VideoCategory
    if (type === "course" && courseId) {
      const category = await VideoCategory.findById(video.videoCategoryId).select("courseId").lean();
      if (!category || String(category.courseId) !== courseId) {
        return failure(res, "Lecture does not belong to this course", 403);
      }
    }

    // Free videos: return encrypted data without subscription check
    if (video.priceType === "free") {
      const { token, videoURL } = encryptVideoSource(video);
      logger.info("getLectureHandler: free lecture served", { traceId, userId, videoId });
      return success(res, {
        _id: video._id,
        title: video.title,
        platform: video.platform,
        token,
        videoURL,
      }, "Lecture fetched successfully.", 200);
    }

    // Paid videos: require active subscription
    let isSubscribed = false;

    if (type === "course" && courseId) {
      isSubscribed = await hasActiveCourseSubscription(userId, courseId);
    } else if (type === "package" && packageId) {
      isSubscribed = await hasActivePackageSubscription(userId, packageId);
    }

    if (!isSubscribed) {
      logger.warn("getLectureHandler: no active subscription", { traceId, userId, videoId, type });
      return failure(res, "Active subscription required to access this lecture", 403);
    }

    const { token, videoURL } = encryptVideoSource(video);
    logger.info("getLectureHandler: paid lecture served", { traceId, userId, videoId });
    return success(res, {
      _id: video._id,
      title: video.title,
      platform: video.platform,
      token,
      videoURL,
    }, "Lecture fetched successfully.", 200);

  } catch (err) {
    logger.error("getLectureHandler failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};
