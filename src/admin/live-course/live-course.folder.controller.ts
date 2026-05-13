import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Video } from "../../models/course/Video.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

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
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    if (!(await assertCourseExists(liveCourseId))) {
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

    return success(res, { folders, relations }, "Folders fetched.");
  } catch (err) {
    logger.error("LiveCourse listFolders failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list folders.", 500);
  }
};

// POST /api/v1/admin/live-courses/:liveCourseId/folders
// Creates a folder under this live course. If parentFolderId is given, also
// inserts a VideoCategoryRelation row (parent → new child).
export const createFolder = async (req: Request, res: Response) => {
  const txn = await mongoose.startSession();
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    if (!(await assertCourseExists(liveCourseId))) {
      return failure(res, "Live course not found.", 404);
    }

    let validated: z.infer<typeof createFolderSchema>;
    try {
      validated = createFolderSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    if (validated.parentFolderId) {
      const parentOk = await assertFolderBelongsToCourse(validated.parentFolderId, liveCourseId);
      if (!parentOk) return failure(res, "parentFolderId does not belong to this live course.", 422);
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
    logger.info("LiveCourse folder created", { liveCourseId, folderId: folder._id });
    return success(res, { folder: folder.toObject() }, "Folder created.", 201);
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("LiveCourse createFolder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to create folder.", 500);
  } finally {
    txn.endSession();
  }
};

// PATCH /api/v1/admin/live-courses/:liveCourseId/folders/:folderId
export const updateFolder = async (req: Request, res: Response) => {
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    const folderId = String(req.params.folderId ?? "");
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      return failure(res, "Folder not found in this live course.", 404);
    }

    let validated: z.infer<typeof updateFolderSchema>;
    try {
      validated = updateFolderSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    const updated = await VideoCategory.findByIdAndUpdate(folderId, validated, {
      new: true,
      runValidators: true,
    });
    return success(res, { folder: updated?.toObject() }, "Folder updated.");
  } catch (err) {
    logger.error("LiveCourse updateFolder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to update folder.", 500);
  }
};

// DELETE /api/v1/admin/live-courses/:liveCourseId/folders/:folderId
// Refuses to delete the root folder (the one stored on LiveCourse.videoCategoryId).
// Cascades: deletes all videos in this folder, all relations referencing it.
export const deleteFolder = async (req: Request, res: Response) => {
  const txn = await mongoose.startSession();
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    const folderId = String(req.params.folderId ?? "");

    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      return failure(res, "Folder not found in this live course.", 404);
    }

    const course = await LiveCourse.findById(liveCourseId).select("videoCategoryId").lean();
    if (course?.videoCategoryId && String(course.videoCategoryId) === folderId) {
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
    logger.info("LiveCourse folder deleted", {
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
    logger.error("LiveCourse deleteFolder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to delete folder.", 500);
  } finally {
    txn.endSession();
  }
};
