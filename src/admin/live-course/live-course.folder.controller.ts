import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Video } from "../../models/course/Video.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveCourseSql from "../../modules/admin-live-course/admin-live-course.service";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const createFolderSchema = z
  .object({
    title:           z.string().trim().min(1, "Title is required").max(300),
    image:           z.string().url("Image must be a valid URL").optional(),
    parentFolderId:  objectId.optional(),
    order_by:        z.number().int().optional(),
    educatorId:      objectId.optional(),
    status:          z.boolean().optional(),
  })
  .strict();

const updateFolderSchema = z
  .object({
    title:      z.string().trim().min(1).max(300).optional(),
    image:      z.string().url().optional(),
    order_by:   z.number().int().optional(),
    educatorId: objectId.optional(),
    status:     z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

async function assertCourseExists(liveCourseId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(liveCourseId)) return false;
  return Boolean(await LiveCourse.exists({ _id: liveCourseId }));
}

async function assertFolderBelongsToCourse(folderId: string, liveCourseId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(folderId)) return false;
  return Boolean(await VideoCategory.exists({ _id: folderId, liveCourseId }));
}

// GET /api/v1/admin/live-courses/:liveCourseId/folders
// Returns the flat list of folders for this course PLUS the parent/child
// relation rows so the UI can build a tree.
export const listFolders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  logger.info("listFolders invoked", { traceId, path: req.originalUrl, liveCourseId, userId: req.user?.id });

  if (liveCourseSql.isAdminLiveCourseMysql()) {
    try {
      const id = liveCourseSql.parseLiveId(liveCourseId);
      if (id == null || !(await liveCourseSql.lcCourseExists(id))) {
        logger.warn("listFolders course not found (sql)", { traceId, liveCourseId });
        return failure(res, "Live course not found.", 404);
      }
      const { folders, relations } = await liveCourseSql.lcListFolders(id);
      logger.info("listFolders success (sql)", { traceId, liveCourseId, folderCount: folders.length, relationCount: relations.length });
      return success(res, { folders, relations }, "Folders fetched.");
    } catch (err) {
      logger.error("listFolders failed (sql)", { traceId, liveCourseId, error: getErrorMessage(err), stack: (err as Error).stack });
      return failure(res, "Failed to list folders.", 500);
    }
  }

  try {
    if (!(await assertCourseExists(liveCourseId))) {
      logger.warn("listFolders course not found", { traceId, liveCourseId });
      return failure(res, "Live course not found.", 404);
    }

    const folders = await VideoCategory.find({ liveCourseId })
      .sort({ order_by: 1, createdAt: 1 })
      .lean();

    const ids = folders.map((f) => f._id);
    const relations = ids.length
      ? await VideoCategoryRelation.find({
          $or: [{ parent: { $in: ids } }, { child: { $in: ids } }],
        }).lean()
      : [];

    logger.info("listFolders success", { traceId, liveCourseId, folderCount: folders.length, relationCount: relations.length });
    return success(res, { folders, relations }, "Folders fetched.");
  } catch (err) {
    logger.error("listFolders failed", { traceId, liveCourseId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list folders.", 500);
  }
};

// POST /api/v1/admin/live-courses/:liveCourseId/folders
// Creates a folder under this live course. If parentFolderId is given, also
// inserts a VideoCategoryRelation row (parent → new child).
export const createFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  logger.info("createFolder invoked", { traceId, path: req.originalUrl, liveCourseId, userId: req.user?.id });

  if (liveCourseSql.isAdminLiveCourseMysql()) {
    try {
      const id = liveCourseSql.parseLiveId(liveCourseId);
      if (id == null || !(await liveCourseSql.lcCourseExists(id))) {
        logger.warn("createFolder course not found (sql)", { traceId, liveCourseId });
        return failure(res, "Live course not found.", 404);
      }
      let validated: z.infer<typeof createFolderSchema>;
      try {
        validated = createFolderSchema.parse(req.body);
      } catch (err) {
        if (err instanceof z.ZodError) {
          logger.warn("createFolder validation failed (sql)", { traceId, liveCourseId, issues: err.issues });
          return zodIssueResponse(res, err);
        }
        throw err;
      }
      const result = await liveCourseSql.lcCreateFolder(id, {
        title: validated.title,
        image: validated.image,
        parentFolderId: validated.parentFolderId ? liveCourseSql.parseLiveId(validated.parentFolderId) ?? undefined : undefined,
        order_by: validated.order_by,
        educatorId: validated.educatorId ? liveCourseSql.parseLiveId(validated.educatorId) ?? undefined : undefined,
        status: validated.status,
      });
      if (result === "bad_parent") {
        logger.warn("createFolder invalid parent (sql)", { traceId, liveCourseId, parentFolderId: validated.parentFolderId });
        return failure(res, "parentFolderId does not belong to this live course.", 422);
      }
      logger.info("createFolder success (sql)", { traceId, liveCourseId, folderId: result.folder._id });
      return success(res, { folder: result.folder }, "Folder created.", 201);
    } catch (err) {
      logger.error("createFolder failed (sql)", { traceId, liveCourseId, error: getErrorMessage(err), stack: (err as Error).stack });
      return failure(res, "Failed to create folder.", 500);
    }
  }

  const txn = await mongoose.startSession();
  try {
    if (!(await assertCourseExists(liveCourseId))) {
      logger.warn("createFolder course not found", { traceId, liveCourseId });
      return failure(res, "Live course not found.", 404);
    }

    let validated: z.infer<typeof createFolderSchema>;
    try {
      validated = createFolderSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.warn("createFolder validation failed", { traceId, liveCourseId, issues: err.issues });
        return zodIssueResponse(res, err);
      }
      throw err;
    }

    if (validated.parentFolderId) {
      const parentOk = await assertFolderBelongsToCourse(validated.parentFolderId, liveCourseId);
      if (!parentOk) {
        logger.warn("createFolder invalid parent", { traceId, liveCourseId, parentFolderId: validated.parentFolderId });
        return failure(res, "parentFolderId does not belong to this live course.", 422);
      }
    }

    txn.startTransaction();

    const courseDoc = await LiveCourse.findById(liveCourseId).select("image").lean();
    const fallbackImage = courseDoc?.image ?? "";

    const [folder] = await VideoCategory.create(
      [
        {
          title: validated.title,
          slug: `${slugify(validated.title)}-${Date.now().toString(36)}`,
          image: validated.image ?? fallbackImage,
          liveCourseId: new Types.ObjectId(liveCourseId),
          educatorId: validated.educatorId ? new Types.ObjectId(validated.educatorId) : null,
          order_by: validated.order_by ?? 0,
          status: validated.status ?? true,
        },
      ],
      { session: txn }
    );

    if (validated.parentFolderId) {
      await VideoCategoryRelation.create(
        [
          {
            parent: new Types.ObjectId(validated.parentFolderId),
            child: folder._id,
            order: validated.order_by ?? 0,
          },
        ],
        { session: txn }
      );
    }

    await txn.commitTransaction();
    logger.info("createFolder success", { traceId, liveCourseId, folderId: folder._id });
    return success(res, { folder: folder.toObject() }, "Folder created.", 201);
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("createFolder failed", { traceId, liveCourseId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create folder.", 500);
  } finally {
    txn.endSession();
  }
};

// PATCH /api/v1/admin/live-courses/:liveCourseId/folders/:folderId
export const updateFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("updateFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, userId: req.user?.id });

  if (liveCourseSql.isAdminLiveCourseMysql()) {
    try {
      const cid = liveCourseSql.parseLiveId(liveCourseId);
      const fid = liveCourseSql.parseLiveId(folderId);
      if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
        logger.warn("updateFolder folder not found (sql)", { traceId, liveCourseId, folderId });
        return failure(res, "Folder not found in this live course.", 404);
      }
      let validated: z.infer<typeof updateFolderSchema>;
      try {
        validated = updateFolderSchema.parse(req.body);
      } catch (err) {
        if (err instanceof z.ZodError) {
          logger.warn("updateFolder validation failed (sql)", { traceId, liveCourseId, folderId, issues: err.issues });
          return zodIssueResponse(res, err);
        }
        throw err;
      }
      const folder = await liveCourseSql.lcUpdateFolder(cid, fid, {
        title: validated.title,
        image: validated.image,
        order_by: validated.order_by,
        educatorId: validated.educatorId ? liveCourseSql.parseLiveId(validated.educatorId) ?? undefined : undefined,
        status: validated.status,
      });
      logger.info("updateFolder success (sql)", { traceId, liveCourseId, folderId });
      return success(res, { folder }, "Folder updated.");
    } catch (err) {
      logger.error("updateFolder failed (sql)", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
      return failure(res, "Failed to update folder.", 500);
    }
  }

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("updateFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }

    let validated: z.infer<typeof updateFolderSchema>;
    try {
      validated = updateFolderSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.warn("updateFolder validation failed", { traceId, liveCourseId, folderId, issues: err.issues });
        return zodIssueResponse(res, err);
      }
      throw err;
    }

    const updated = await VideoCategory.findByIdAndUpdate(folderId, validated, {
      new: true,
      runValidators: true,
    });
    logger.info("updateFolder success", { traceId, liveCourseId, folderId });
    return success(res, { folder: updated?.toObject() }, "Folder updated.");
  } catch (err) {
    logger.error("updateFolder failed", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update folder.", 500);
  }
};

// DELETE /api/v1/admin/live-courses/:liveCourseId/folders/:folderId
// Refuses to delete the root folder (the one stored on LiveCourse.videoCategoryId).
// Cascades: deletes all videos in this folder, all relations referencing it.
export const deleteFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("deleteFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, userId: req.user?.id });

  if (liveCourseSql.isAdminLiveCourseMysql()) {
    try {
      const cid = liveCourseSql.parseLiveId(liveCourseId);
      const fid = liveCourseSql.parseLiveId(folderId);
      if (cid == null || fid == null) {
        logger.warn("deleteFolder folder not found (sql)", { traceId, liveCourseId, folderId });
        return failure(res, "Folder not found in this live course.", 404);
      }
      const result = await liveCourseSql.lcDeleteFolder(cid, fid);
      if (result === "not_found") {
        logger.warn("deleteFolder folder not found (sql)", { traceId, liveCourseId, folderId });
        return failure(res, "Folder not found in this live course.", 404);
      }
      if (result === "is_root") {
        logger.warn("deleteFolder refused root (sql)", { traceId, liveCourseId, folderId });
        return failure(res, "Cannot delete the root folder of a live course.", 409);
      }
      logger.info("deleteFolder success (sql)", { traceId, liveCourseId, folderId, videos: result.deletedVideos, relations: result.deletedRelations });
      return success(res, { id: folderId, deletedVideos: result.deletedVideos, deletedRelations: result.deletedRelations }, "Folder deleted.");
    } catch (err) {
      logger.error("deleteFolder failed (sql)", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
      return failure(res, "Failed to delete folder.", 500);
    }
  }

  const txn = await mongoose.startSession();
  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("deleteFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }

    const course = await LiveCourse.findById(liveCourseId).select("videoCategoryId").lean();
    if (course?.videoCategoryId && String(course.videoCategoryId) === folderId) {
      logger.warn("deleteFolder refused root", { traceId, liveCourseId, folderId });
      return failure(res, "Cannot delete the root folder of a live course.", 409);
    }

    txn.startTransaction();

    const [videos, relations] = await Promise.all([
      Video.deleteMany({ videoCategoryId: folderId }, { session: txn }),
      VideoCategoryRelation.deleteMany(
        { $or: [{ parent: folderId }, { child: folderId }] },
        { session: txn }
      ),
    ]);

    await VideoCategory.deleteOne({ _id: folderId }, { session: txn });

    await txn.commitTransaction();
    logger.info("deleteFolder success", {
      traceId,
      liveCourseId,
      folderId,
      videos: videos.deletedCount,
      relations: relations.deletedCount,
    });

    return success(
      res,
      {
        id: folderId,
        deletedVideos: videos.deletedCount ?? 0,
        deletedRelations: relations.deletedCount ?? 0,
      },
      "Folder deleted."
    );
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("deleteFolder failed", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete folder.", 500);
  } finally {
    txn.endSession();
  }
};
