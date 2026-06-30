// src/admin/live-course/live-course.service.ts
//
// Domain logic for admin live-course endpoints. Delegates to the MySQL/Prisma
// module; HttpError gives the thin controllers predictable status codes.

import { HttpError } from "../../middlewares/errorHandler";
import * as sql from "../../modules/admin-live-course/admin-live-course.service";

// Re-exported so the thin controllers can branch validation.
export const isLiveCourseMysql = sql.isLiveCourseMysql;
export const parseLiveSqlId = sql.parseLiveId;

// Ids are numeric on the SQL path.
const assertLiveSqlId = (id: string, label: string): number => {
  const n = sql.parseLiveId(id);
  if (!n) throw new HttpError(422, `Invalid ${label} id.`);
  return n;
};

const MAX_FOLDERS_PER_COURSE = 50;
const MAX_ENTRIES_PER_FOLDER = 500;

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

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

export const createLiveCourse = async (validated: any, createdById?: string) => {
  return sql.createLiveCourse(validated, createdById);
};

export interface ListLiveCoursesQuery {
  search?: string;
  status?: string;
  page?: string;
  limit?: string;
}

export const listLiveCourses = async (query: ListLiveCoursesQuery) => {
  return sql.listLiveCourses(query);
};

export const getLiveCourseById = async (id: string) => {
  const r = await sql.getLiveCourseById(assertLiveSqlId(id, "live course"));
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  return r;
};

export const updateLiveCourse = async (id: string, validated: any) => {
  const r = await sql.updateLiveCourse(assertLiveSqlId(id, "live course"), validated);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  return r;
};

export const deleteLiveCourse = async (id: string) => {
  const r = await sql.deleteLiveCourse(assertLiveSqlId(id, "live course"));
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "has_sessions") throw new HttpError(409, "Cannot delete: live session(s) are attached to this course.");
  return r;
};

export const toggleLiveCoursePopular = async (id: string) => {
  const r = await sql.togglePopular(assertLiveSqlId(id, "live course"));
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  return r;
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
  const r = await sql.listSessionsForCourse(assertLiveSqlId(id, "live course"), query);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  return r;
};

// ──────────────────────────────────────────────────────────────────────────────
// Schedule (folder-grouped entries)
// ──────────────────────────────────────────────────────────────────────────────

export const listScheduleFolders = async (id: string) => {
  const r = await sql.listScheduleFolders(assertLiveSqlId(id, "live course"));
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  return r;
};

export const createScheduleFolder = async (id: string, input: ScheduleFolderInput) => {
  const r = await sql.createScheduleFolder(assertLiveSqlId(id, "live course"), input);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "max") throw new HttpError(400, `A course can have at most ${MAX_FOLDERS_PER_COURSE} schedule folders.`);
  return r;
};

export const updateScheduleFolder = async (
  id: string,
  folderId: string,
  patch: ScheduleFolderPatch
) => {
  const r = await sql.updateScheduleFolder(assertLiveSqlId(id, "live course"), folderId, patch);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "folder_not_found") throw new HttpError(404, "Schedule folder not found.");
  return r;
};

export const deleteScheduleFolder = async (id: string, folderId: string) => {
  const r = await sql.deleteScheduleFolder(assertLiveSqlId(id, "live course"), folderId);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "folder_not_found") throw new HttpError(404, "Schedule folder not found.");
  return { success: true };
};

export const reorderScheduleFolders = async (id: string, folderIds: string[]) => {
  const r = await sql.reorderScheduleFolders(assertLiveSqlId(id, "live course"), folderIds);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "mismatch") throw new HttpError(400, "folderIds must contain exactly the existing folder ids.");
  return r;
};

// Entries ─────────────────────────────────────────────────────────────────────

export const listScheduleEntries = async (id: string, folderId: string) => {
  const r = await sql.listScheduleEntries(assertLiveSqlId(id, "live course"), folderId);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "folder_not_found") throw new HttpError(404, "Schedule folder not found.");
  return r;
};

export const createScheduleEntry = async (
  id: string,
  folderId: string,
  input: ScheduleEntryInput
) => {
  const r = await sql.createScheduleEntry(assertLiveSqlId(id, "live course"), folderId, input);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "folder_not_found") throw new HttpError(404, "Schedule folder not found.");
  if (r === "max") throw new HttpError(400, `A folder can have at most ${MAX_ENTRIES_PER_FOLDER} entries.`);
  return r;
};

export const updateScheduleEntry = async (
  id: string,
  folderId: string,
  entryId: string,
  patch: ScheduleEntryPatch
) => {
  const r = await sql.updateScheduleEntry(assertLiveSqlId(id, "live course"), folderId, entryId, patch);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "folder_not_found") throw new HttpError(404, "Schedule folder not found.");
  if (r === "entry_not_found") throw new HttpError(404, "Schedule entry not found.");
  return r;
};

export const deleteScheduleEntry = async (
  id: string,
  folderId: string,
  entryId: string
) => {
  const r = await sql.deleteScheduleEntry(assertLiveSqlId(id, "live course"), folderId, entryId);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "folder_not_found") throw new HttpError(404, "Schedule folder not found.");
  if (r === "entry_not_found") throw new HttpError(404, "Schedule entry not found.");
  return { success: true };
};

export const reorderScheduleEntries = async (
  id: string,
  folderId: string,
  entryIds: string[]
) => {
  const r = await sql.reorderScheduleEntries(assertLiveSqlId(id, "live course"), folderId, entryIds);
  if (r === "not_found") throw new HttpError(404, "Live course not found.");
  if (r === "folder_not_found") throw new HttpError(404, "Schedule folder not found.");
  if (r === "mismatch") throw new HttpError(400, "entryIds must contain exactly the existing entry ids.");
  return r;
};
