// src/admin/live-course/live-course.service.ts
//
// Domain logic for admin live-course endpoints. Same canonical pattern as
// course/package: `.lean()` reads, transactions on multi-doc writes, cache
// integration, HttpError for predictable status codes.

import mongoose, { Types } from "mongoose";
import { LiveCourse, ILiveCourse } from "../../models/course/LiveCourse.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { PackageCategory } from "../../models/course/PackageCategory.model";
import { ExamCountdownCategory } from "../../models/examCountdown/ExamCountdownCategory.model";
import { ExamCountdown } from "../../models/examCountdown/ExamCountdown.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Video } from "../../models/course/Video.model";
import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(422, `Invalid ${label} id.`);
  }
};

// Cache keys ──────────────────────────────────────────────────────────────────
const listKey = (filter: any, page: number, limit: number) =>
  cache.key("admin", "live-course", `list:${cache.hashFilter({ filter, page, limit })}`);
const detailKey = (id: string) => cache.key("admin", "live-course", `detail:${id}`);

const invalidateCaches = async (id?: string) => {
  const keys: string[] = [];
  if (id) keys.push(detailKey(id));
  await Promise.all([
    cache.invalidate(...keys),
    cache.invalidateByPrefix(cache.key("admin", "live-course", "list:")),
  ]);
};

// ──────────────────────────────────────────────────────────────────────────────
// Reference assertions
// ──────────────────────────────────────────────────────────────────────────────

export const assertRefsExist = async (input: {
  courseEducatorId?: string;
  packageCategoryId?: string;
  examCountdownCategoryIds?: string[];
  examCountdownIds?: string[];
}): Promise<void> => {
  if (input.courseEducatorId) {
    const exists = await CourseEducator.exists({ _id: input.courseEducatorId });
    if (!exists)
      throw new HttpError(422, "courseEducatorId does not reference an existing educator.");
  }
  if (input.packageCategoryId) {
    const exists = await PackageCategory.exists({
      _id: input.packageCategoryId,
      status: true,
    });
    if (!exists)
      throw new HttpError(
        422,
        "packageCategoryId does not reference an existing active package category."
      );
  }
  if (input.examCountdownCategoryIds?.length) {
    const count = await ExamCountdownCategory.countDocuments({
      _id: { $in: input.examCountdownCategoryIds },
    });
    if (count !== new Set(input.examCountdownCategoryIds).size)
      throw new HttpError(422, "One or more examCountdownCategoryIds do not exist.");
  }
  if (input.examCountdownIds?.length) {
    const count = await ExamCountdown.countDocuments({
      _id: { $in: input.examCountdownIds },
    });
    if (count !== new Set(input.examCountdownIds).size)
      throw new HttpError(422, "One or more examCountdownIds do not exist.");
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

export const createLiveCourse = async (validated: any, createdById?: string) => {
  await assertRefsExist(validated);

  const session = await mongoose.startSession();
  try {
    let course: any;
    let rootFolder: any;

    await session.withTransaction(async () => {
      const [created] = await LiveCourse.create(
        [
          {
            ...validated,
            createdBy: createdById ? new Types.ObjectId(createdById) : null,
          },
        ],
        { session }
      );
      course = created;

      const slug = course.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const [folder] = await VideoCategory.create(
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
      rootFolder = folder;

      course.videoCategoryId = folder._id as Types.ObjectId;
      await course.save({ session });
    });

    await invalidateCaches();
    return { liveCourse: course.toObject(), rootFolder: rootFolder.toObject() };
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new HttpError(409, "A live course with this name already exists.");
    }
    throw err;
  } finally {
    session.endSession();
  }
};

export interface ListLiveCoursesQuery {
  search?: string;
  status?: string;
  page?: string;
  limit?: string;
}

export const listLiveCourses = async (query: ListLiveCoursesQuery) => {
  const page = Math.max(1, parseInt(query.page as any) || 1);
  const limit = Math.min(100, parseInt(query.limit as any) || 20);
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const statusFilter = query.status;

  const filter: Record<string, any> = {};
  if (search) filter.name = { $regex: search, $options: "i" };
  if (statusFilter === "true" || statusFilter === "false") {
    filter.status = statusFilter === "true";
  }

  return cache.aside({
    key: listKey(filter, page, limit),
    ttlSeconds: 300,
    load: async () => {
      const [rows, total] = await Promise.all([
        LiveCourse.find(filter)
          .sort({ ordered: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate("courseEducatorId", "name image")
          .populate("packageCategoryId", "title slug image")
          .lean(),
        LiveCourse.countDocuments(filter),
      ]);
      return { liveCourses: rows, total, page, limit };
    },
  });
};

export const getLiveCourseById = async (id: string) => {
  assertObjectId(id, "live course");
  return cache.aside({
    key: detailKey(id),
    ttlSeconds: 300,
    load: async () => {
      const doc = await LiveCourse.findById(id)
        .populate("courseEducatorId", "name image")
        .populate("packageCategoryId", "title slug image")
        .lean();
      if (!doc) throw new HttpError(404, "Live course not found.");
      return { liveCourse: doc };
    },
  });
};

export const updateLiveCourse = async (id: string, validated: any) => {
  assertObjectId(id, "live course");
  await assertRefsExist(validated);
  try {
    const doc = await LiveCourse.findByIdAndUpdate(id, validated, {
      new: true,
      runValidators: true,
    });
    if (!doc) throw new HttpError(404, "Live course not found.");
    await invalidateCaches(id);
    return { liveCourse: doc.toObject() };
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new HttpError(409, "A live course with this name already exists.");
    }
    throw err;
  }
};

export const deleteLiveCourse = async (id: string) => {
  assertObjectId(id, "live course");

  const sessionCount = await LiveSession.countDocuments({ liveCourseIds: id });
  if (sessionCount > 0) {
    throw new HttpError(
      409,
      `Cannot delete: ${sessionCount} live session(s) are attached to this course.`
    );
  }

  const txn = await mongoose.startSession();
  try {
    let result: {
      id: string;
      deletedFolders: number;
      deletedVideos: number;
      deletedRelations: number;
    } | null = null;

    await txn.withTransaction(async () => {
      const doc = await LiveCourse.findByIdAndDelete(id, { session: txn });
      if (!doc) throw new HttpError(404, "Live course not found.");

      const folders = await VideoCategory.find(
        { liveCourseId: id },
        { _id: 1 },
        { session: txn }
      );
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

      result = {
        id,
        deletedFolders: folderIds.length,
        deletedVideos: videos.deletedCount ?? 0,
        deletedRelations: relations.deletedCount ?? 0,
      };
    });

    await invalidateCaches(id);
    return result!;
  } finally {
    txn.endSession();
  }
};

export const toggleLiveCoursePopular = async (id: string) => {
  assertObjectId(id, "live course");
  const doc = (await LiveCourse.findById(id)) as ILiveCourse | null;
  if (!doc) throw new HttpError(404, "Live course not found.");
  doc.isPopular = !doc.isPopular;
  await doc.save();
  await invalidateCaches(id);
  return { id, isPopular: doc.isPopular };
};

// ──────────────────────────────────────────────────────────────────────────────
// Sessions for a live course
// ──────────────────────────────────────────────────────────────────────────────

export interface ListSessionsQuery {
  status?: string;
  upcoming?: string;
  page?: string;
  limit?: string;
}

export const listSessionsForLiveCourse = async (id: string, query: ListSessionsQuery) => {
  assertObjectId(id, "live course");
  const exists = await LiveCourse.exists({ _id: id });
  if (!exists) throw new HttpError(404, "Live course not found.");

  const status = typeof query.status === "string" ? query.status : undefined;
  const upcoming = query.upcoming === "true";
  const page = Math.max(1, parseInt(query.page as any) || 1);
  const limit = Math.min(100, parseInt(query.limit as any) || 50);

  const filter: Record<string, any> = { liveCourseIds: id };
  if (status) filter.status = status;
  if (upcoming) {
    filter.status = "SCHEDULED";
    filter.scheduledAt = { $gte: new Date() };
  }

  const [rows, total] = await Promise.all([
    LiveSession.find(filter)
      .sort({ scheduledAt: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LiveSession.countDocuments(filter),
  ]);

  return { sessions: rows, total, page, limit };
};

// ──────────────────────────────────────────────────────────────────────────────
// Schedule (folder-grouped entries)
// ──────────────────────────────────────────────────────────────────────────────

const MAX_FOLDERS_PER_COURSE = 50;
const MAX_ENTRIES_PER_FOLDER = 500;

const sortFolders = (folders: any[]) =>
  [...folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

const sortEntries = (entries: any[]) =>
  [...entries].sort(
    (a, b) =>
      ((a.order ?? 0) - (b.order ?? 0)) ||
      (new Date(a.date).getTime() - new Date(b.date).getTime())
  );

const projectFolder = (f: any) => ({
  _id: f._id,
  title: f.title,
  image: f.image ?? null,
  order: f.order ?? 0,
  status: f.status !== false,
  entries: sortEntries(f.entries ?? []),
});

export type ScheduleFolderInput = {
  title: string;
  image?: string | null;
  order?: number;
  status?: boolean;
};

export type ScheduleFolderPatch = Partial<ScheduleFolderInput>;

export type ScheduleEntryInput = {
  date: Date;
  subject: string;
  time: string;
  order?: number;
};

export type ScheduleEntryPatch = Partial<ScheduleEntryInput>;

const loadCourse = async (id: string) => {
  assertObjectId(id, "live course");
  const doc = await LiveCourse.findById(id);
  if (!doc) throw new HttpError(404, "Live course not found.");
  return doc;
};

export const listScheduleFolders = async (id: string) => {
  const doc = await loadCourse(id);
  const folders = sortFolders(doc.scheduleFolders ?? []).map(projectFolder);
  return { scheduleFolders: folders };
};

export const createScheduleFolder = async (id: string, input: ScheduleFolderInput) => {
  const doc = await loadCourse(id);
  if ((doc.scheduleFolders?.length ?? 0) >= MAX_FOLDERS_PER_COURSE) {
    throw new HttpError(400, `A course can have at most ${MAX_FOLDERS_PER_COURSE} schedule folders.`);
  }
  const order = typeof input.order === "number" ? input.order : (doc.scheduleFolders?.length ?? 0);
  const folder: any = {
    title: input.title,
    image: input.image ?? null,
    order,
    status: input.status ?? true,
    entries: [],
  };
  doc.scheduleFolders.push(folder);
  await doc.save();
  await invalidateCaches(id);
  const created = doc.scheduleFolders[doc.scheduleFolders.length - 1];
  return { scheduleFolder: projectFolder(created) };
};

export const updateScheduleFolder = async (
  id: string,
  folderId: string,
  patch: ScheduleFolderPatch
) => {
  assertObjectId(folderId, "schedule folder");
  const doc = await loadCourse(id);
  const folder = (doc.scheduleFolders as any).id(folderId);
  if (!folder) throw new HttpError(404, "Schedule folder not found.");

  if (patch.title !== undefined) folder.title = patch.title;
  if (patch.image !== undefined) folder.image = patch.image;
  if (patch.order !== undefined) folder.order = patch.order;
  if (patch.status !== undefined) folder.status = patch.status;

  await doc.save();
  await invalidateCaches(id);
  return { scheduleFolder: projectFolder(folder) };
};

export const deleteScheduleFolder = async (id: string, folderId: string) => {
  assertObjectId(folderId, "schedule folder");
  const doc = await loadCourse(id);
  const folder = (doc.scheduleFolders as any).id(folderId);
  if (!folder) throw new HttpError(404, "Schedule folder not found.");
  folder.deleteOne();
  await doc.save();
  await invalidateCaches(id);
  return { success: true };
};

export const reorderScheduleFolders = async (id: string, folderIds: string[]) => {
  const doc = await loadCourse(id);
  const existing = (doc.scheduleFolders ?? []) as any[];

  if (folderIds.length !== existing.length) {
    throw new HttpError(400, "folderIds must contain exactly the existing folder ids.");
  }
  const existingSet = new Set(existing.map((f) => String(f._id)));
  const incomingSet = new Set(folderIds.map(String));
  if (existingSet.size !== incomingSet.size || [...existingSet].some((x) => !incomingSet.has(x))) {
    throw new HttpError(400, "folderIds must contain exactly the existing folder ids.");
  }

  folderIds.forEach((fid, idx) => {
    const folder = existing.find((f) => String(f._id) === String(fid));
    if (folder) folder.order = idx;
  });

  await doc.save();
  await invalidateCaches(id);
  return { scheduleFolders: sortFolders(doc.scheduleFolders).map(projectFolder) };
};

// Entries ─────────────────────────────────────────────────────────────────────

const loadFolder = async (id: string, folderId: string) => {
  assertObjectId(folderId, "schedule folder");
  const doc = await loadCourse(id);
  const folder = (doc.scheduleFolders as any).id(folderId);
  if (!folder) throw new HttpError(404, "Schedule folder not found.");
  return { doc, folder };
};

export const listScheduleEntries = async (id: string, folderId: string) => {
  const { folder } = await loadFolder(id, folderId);
  return { entries: sortEntries(folder.entries ?? []) };
};

export const createScheduleEntry = async (
  id: string,
  folderId: string,
  input: ScheduleEntryInput
) => {
  const { doc, folder } = await loadFolder(id, folderId);
  if ((folder.entries?.length ?? 0) >= MAX_ENTRIES_PER_FOLDER) {
    throw new HttpError(400, `A folder can have at most ${MAX_ENTRIES_PER_FOLDER} entries.`);
  }
  const order = typeof input.order === "number" ? input.order : (folder.entries?.length ?? 0);
  const entry: any = {
    date: input.date,
    subject: input.subject,
    time: input.time,
    order,
  };
  folder.entries.push(entry);
  await doc.save();
  await invalidateCaches(id);
  const created = folder.entries[folder.entries.length - 1];
  return { entry: created.toObject ? created.toObject() : created };
};

export const updateScheduleEntry = async (
  id: string,
  folderId: string,
  entryId: string,
  patch: ScheduleEntryPatch
) => {
  assertObjectId(entryId, "schedule entry");
  const { doc, folder } = await loadFolder(id, folderId);
  const entry = folder.entries.id(entryId);
  if (!entry) throw new HttpError(404, "Schedule entry not found.");

  if (patch.date !== undefined) entry.date = patch.date;
  if (patch.subject !== undefined) entry.subject = patch.subject;
  if (patch.time !== undefined) entry.time = patch.time;
  if (patch.order !== undefined) entry.order = patch.order;

  await doc.save();
  await invalidateCaches(id);
  return { entry: entry.toObject ? entry.toObject() : entry };
};

export const deleteScheduleEntry = async (
  id: string,
  folderId: string,
  entryId: string
) => {
  assertObjectId(entryId, "schedule entry");
  const { doc, folder } = await loadFolder(id, folderId);
  const entry = folder.entries.id(entryId);
  if (!entry) throw new HttpError(404, "Schedule entry not found.");
  entry.deleteOne();
  await doc.save();
  await invalidateCaches(id);
  return { success: true };
};

export const reorderScheduleEntries = async (
  id: string,
  folderId: string,
  entryIds: string[]
) => {
  const { doc, folder } = await loadFolder(id, folderId);
  const existing = folder.entries as any[];

  if (entryIds.length !== existing.length) {
    throw new HttpError(400, "entryIds must contain exactly the existing entry ids.");
  }
  const existingSet = new Set(existing.map((e) => String(e._id)));
  const incomingSet = new Set(entryIds.map(String));
  if (existingSet.size !== incomingSet.size || [...existingSet].some((x) => !incomingSet.has(x))) {
    throw new HttpError(400, "entryIds must contain exactly the existing entry ids.");
  }

  entryIds.forEach((eid, idx) => {
    const entry = existing.find((e) => String(e._id) === String(eid));
    if (entry) entry.order = idx;
  });

  await doc.save();
  await invalidateCaches(id);
  return { entries: sortEntries(folder.entries) };
};
