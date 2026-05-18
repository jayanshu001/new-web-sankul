import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { LiveCourse, ILiveCourse } from "../../models/course/LiveCourse.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { LiveCourseCategory } from "../../models/course/LiveCourseCategory.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Video } from "../../models/course/Video.model";
import {
  createLiveCourseSchema,
  updateLiveCourseSchema,
} from "./live-course.validation";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

// Multipart bodies arrive with everything stringified. Convert just the fields
// our Zod schema expects to be non-strings.
function coerceBody(body: Record<string, any>): Record<string, any> {
  const out = { ...body };
  if (typeof out.ordered === "string")  out.ordered  = Number(out.ordered);
  if (typeof out.status === "string")   out.status   = out.status === "true";
  if (typeof out.isPaid === "string")   out.isPaid   = out.isPaid === "true";
  if (typeof out.isPopular === "string") out.isPopular = out.isPopular === "true";
  return out;
}

async function assertRefsExist(input: {
  courseEducatorId?: string;
  courseSubjectCategoryId?: string;
  liveCourseCategoryId?: string;
}): Promise<string | null> {
  if (input.courseEducatorId) {
    const exists = await CourseEducator.exists({ _id: input.courseEducatorId });
    if (!exists) return "courseEducatorId does not reference an existing educator.";
  }
  if (input.courseSubjectCategoryId) {
    const exists = await CourseSubjectCategory.exists({ _id: input.courseSubjectCategoryId });
    if (!exists) return "courseSubjectCategoryId does not reference an existing subject category.";
  }
  if (input.liveCourseCategoryId) {
    const exists = await LiveCourseCategory.exists({ _id: input.liveCourseCategoryId });
    if (!exists) return "liveCourseCategoryId does not reference an existing live course category.";
  }
  return null;
}

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

// POST /api/v1/admin/live-courses
// Creates the live course AND a default root VideoCategory folder atomically,
// mirroring the recorded course module. Subfolders/videos hang off this root.
export const createLiveCourse = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    let validated: z.infer<typeof createLiveCourseSchema>;
    try {
      validated = createLiveCourseSchema.parse(coerceBody(req.body));
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    const refError = await assertRefsExist(validated);
    if (refError) return failure(res, refError, 422);

    session.startTransaction();

    const [course] = await LiveCourse.create(
      [
        {
          ...validated,
          createdBy: req.user?.id ? new Types.ObjectId(req.user.id) : null,
        },
      ],
      { session }
    );

    const slug = course.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const [rootFolder] = await VideoCategory.create(
      [
        {
          title: `${course.name} - Root`,
          slug: `${slug}-root`,
          image: course.image,
          liveCourseId: course._id,
          order_by: 0,
        },
      ],
      { session }
    );

    course.videoCategoryId = rootFolder._id as Types.ObjectId;
    await course.save({ session });

    await session.commitTransaction();
    logger.info("LiveCourse created", { id: course._id, rootFolderId: rootFolder._id, by: req.user?.id });

    return success(
      res,
      { liveCourse: course.toObject(), rootFolder: rootFolder.toObject() },
      "Live course created with default folder.",
      201
    );
  } catch (err: any) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err?.code === 11000) {
      return failure(res, "A live course with this name already exists.", 409);
    }
    logger.error("LiveCourse create failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to create live course.", 500);
  } finally {
    session.endSession();
  }
};

// GET /api/v1/admin/live-courses
export const listLiveCourses = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const statusFilter = req.query.status;

    const query: Record<string, any> = {};
    if (search) query.name = { $regex: search, $options: "i" };
    if (statusFilter === "true" || statusFilter === "false") {
      query.status = statusFilter === "true";
    }

    const [rows, total] = await Promise.all([
      LiveCourse.find(query)
        .sort({ ordered: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("courseEducatorId", "name image")
        .populate("courseSubjectCategoryId", "title slug")
        .populate("liveCourseCategoryId", "_id title slug image")
        .lean(),
      LiveCourse.countDocuments(query),
    ]);

    return success(
      res,
      { liveCourses: rows, total, page, limit },
      "Live courses fetched."
    );
  } catch (err) {
    logger.error("LiveCourse list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list live courses.", 500);
  }
};

// GET /api/v1/admin/live-courses/:id
export const getLiveCourseById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const doc = await LiveCourse.findById(id)
      .populate("courseEducatorId", "name image")
      .populate("courseSubjectCategoryId", "title slug")
      .populate("liveCourseCategoryId", "_id title slug image")
      .lean();
    if (!doc) return failure(res, "Live course not found.", 404);

    return success(res, { liveCourse: doc }, "Live course fetched.");
  } catch (err) {
    logger.error("LiveCourse getById failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch live course.", 500);
  }
};

// PUT /api/v1/admin/live-courses/:id
export const updateLiveCourse = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    let validated: z.infer<typeof updateLiveCourseSchema>;
    try {
      validated = updateLiveCourseSchema.parse(coerceBody(req.body));
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    const refError = await assertRefsExist(validated);
    if (refError) return failure(res, refError, 422);

    const doc = await LiveCourse.findByIdAndUpdate(id, validated, {
      new: true,
      runValidators: true,
    });
    if (!doc) return failure(res, "Live course not found.", 404);

    return success(res, { liveCourse: doc.toObject() }, "Live course updated.");
  } catch (err: any) {
    if (err?.code === 11000) {
      return failure(res, "A live course with this name already exists.", 409);
    }
    logger.error("LiveCourse update failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to update live course.", 500);
  }
};

// DELETE /api/v1/admin/live-courses/:id
// Refuses if any sessions are still attached. On delete: removes the course,
// all of its folders, the videos in those folders, and any
// VideoCategoryRelation rows linking them — all in one transaction.
export const deleteLiveCourse = async (req: Request, res: Response) => {
  const txn = await mongoose.startSession();
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const sessionCount = await LiveSession.countDocuments({ liveCourseIds: id });
    if (sessionCount > 0) {
      return failure(
        res,
        `Cannot delete: ${sessionCount} live session(s) are attached to this course.`,
        409
      );
    }

    txn.startTransaction();

    const doc = await LiveCourse.findByIdAndDelete(id, { session: txn });
    if (!doc) {
      await txn.abortTransaction();
      return failure(res, "Live course not found.", 404);
    }

    const folders = await VideoCategory.find({ liveCourseId: id }, { _id: 1 }, { session: txn });
    const folderIds = folders.map((f) => f._id);

    const [videos, relations] = await Promise.all([
      folderIds.length
        ? Video.deleteMany({ videoCategoryId: { $in: folderIds } }, { session: txn })
        : Promise.resolve({ deletedCount: 0 } as any),
      folderIds.length
        ? VideoCategoryRelation.deleteMany(
            { $or: [{ parent: { $in: folderIds } }, { child: { $in: folderIds } }] },
            { session: txn }
          )
        : Promise.resolve({ deletedCount: 0 } as any),
    ]);

    await VideoCategory.deleteMany({ liveCourseId: id }, { session: txn });

    await txn.commitTransaction();
    logger.info("LiveCourse deleted", {
      id,
      by: req.user?.id,
      folders: folderIds.length,
      videos: videos.deletedCount,
      relations: relations.deletedCount,
    });

    return success(
      res,
      {
        id,
        deletedFolders: folderIds.length,
        deletedVideos: videos.deletedCount ?? 0,
        deletedRelations: relations.deletedCount ?? 0,
      },
      "Live course deleted."
    );
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("LiveCourse delete failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to delete live course.", 500);
  } finally {
    txn.endSession();
  }
};

// PATCH /api/v1/admin/live-courses/:id/popular
export const toggleLiveCoursePopular = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const doc = (await LiveCourse.findById(id)) as ILiveCourse | null;
    if (!doc) return failure(res, "Live course not found.", 404);

    doc.isPopular = !doc.isPopular;
    await doc.save();

    return success(res, { id, isPopular: doc.isPopular }, "Popular flag toggled.");
  } catch (err) {
    logger.error("LiveCourse toggle popular failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to toggle popular flag.", 500);
  }
};

// GET /api/v1/admin/live-courses/:id/sessions
export const listSessionsForLiveCourse = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const exists = await LiveCourse.exists({ _id: id });
    if (!exists) return failure(res, "Live course not found.", 404);

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const upcoming = req.query.upcoming === "true";
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    const query: Record<string, any> = { liveCourseIds: id };
    if (status) query.status = status;
    if (upcoming) {
      query.status = "SCHEDULED";
      query.scheduledAt = { $gte: new Date() };
    }

    const [rows, total] = await Promise.all([
      LiveSession.find(query)
        .sort({ scheduledAt: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      LiveSession.countDocuments(query),
    ]);

    return success(
      res,
      { sessions: rows, total, page, limit },
      "Sessions fetched."
    );
  } catch (err) {
    logger.error("LiveCourse sessions list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list sessions.", 500);
  }
};

const timetableFilesSchema = z
  .object({
    files: z.array(
      z.object({
        title:   z.string().trim().min(1, "title is required").max(300),
        fileUrl: z.string().url("fileUrl must be a valid URL"),
        order:   z.number().int().optional().default(0),
      })
    ),
  })
  .strict();

// PATCH /api/v1/admin/live-courses/:id/timetable-files
// Replace the whole "Time Table" file list on a live course (the file list on
// the Schedule tab). Upload the files via the generic upload endpoint first,
// then send the resulting URLs here.
export const updateTimetableFiles = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    let validated: z.infer<typeof timetableFilesSchema>;
    try {
      validated = timetableFilesSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    const doc = await LiveCourse.findByIdAndUpdate(
      id,
      { $set: { timetableFiles: validated.files } },
      { new: true, runValidators: true }
    );
    if (!doc) return failure(res, "Live course not found.", 404);

    return success(res, { timetableFiles: doc.timetableFiles }, "Timetable files updated.");
  } catch (err) {
    logger.error("LiveCourse updateTimetableFiles failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to update timetable files.", 500);
  }
};
