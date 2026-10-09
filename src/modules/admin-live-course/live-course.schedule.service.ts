// Live courses: admin schedule folders and entries (JSON columns on ws_live_course). Client schedule reads live in live-course.feed.service.
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import type { LiveCourse } from "@prisma/client";
import { jArr, synthId } from "./live-course.shared";

// ── schedule folders / entries (JSON on ws_live_course; synthetic ids) ──────────
const MAX_FOLDERS = 50, MAX_ENTRIES = 500;
const sortByOrder = (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0);
const projectFolder = (f: any) => ({ _id: f._id, title: f.title, image: f.image ?? null, order: f.order ?? 0, status: f.status !== false, entries: [...(f.entries ?? [])].sort(sortByOrder) });

const loadFolders = async (id: number): Promise<"not_found" | { row: LiveCourse; folders: any[] }> => {
  const row = await repo.findById(id);
  if (!row) return "not_found";
  return { row, folders: jArr(row.scheduleFolders) };
};

export const listScheduleFolders = async (id: number): Promise<"not_found" | { scheduleFolders: any[] }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  return { scheduleFolders: [...r.folders].sort(sortByOrder).map(projectFolder) };
};

export const createScheduleFolder = async (id: number, input: { title: string; image?: string | null; order?: number; status?: boolean }): Promise<"not_found" | "max" | { scheduleFolder: any }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  if (r.folders.length >= MAX_FOLDERS) return "max";
  const folder = { _id: synthId("f"), title: input.title, image: input.image ?? null, order: typeof input.order === "number" ? input.order : r.folders.length, status: input.status ?? true, entries: [] };
  const next = [...r.folders, folder];
  await repo.setSchedule(id, "scheduleFolders", next);
  return { scheduleFolder: projectFolder(folder) };
};

export const updateScheduleFolder = async (id: number, folderId: string, patch: any): Promise<"not_found" | "folder_not_found" | { scheduleFolder: any }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  const folder = r.folders.find((f) => String(f._id) === folderId);
  if (!folder) return "folder_not_found";
  for (const k of ["title", "image", "order", "status"]) if (patch[k] !== undefined) folder[k] = patch[k];
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { scheduleFolder: projectFolder(folder) };
};

export const deleteScheduleFolder = async (id: number, folderId: string): Promise<"not_found" | "folder_not_found" | true> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  if (!r.folders.some((f) => String(f._id) === folderId)) return "folder_not_found";
  await repo.setSchedule(id, "scheduleFolders", r.folders.filter((f) => String(f._id) !== folderId));
  return true;
};

export const reorderScheduleFolders = async (id: number, folderIds: string[]): Promise<"not_found" | "mismatch" | { scheduleFolders: any[] }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  const have = new Set(r.folders.map((f) => String(f._id)));
  if (folderIds.length !== r.folders.length || folderIds.some((x) => !have.has(String(x)))) return "mismatch";
  folderIds.forEach((fid, idx) => { const f = r.folders.find((x) => String(x._id) === String(fid)); if (f) f.order = idx; });
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { scheduleFolders: [...r.folders].sort(sortByOrder).map(projectFolder) };
};

const loadFolder = async (id: number, folderId: string) => {
  const r = await loadFolders(id);
  if (r === "not_found") return "not_found" as const;
  const folder = r.folders.find((f) => String(f._id) === folderId);
  if (!folder) return "folder_not_found" as const;
  return { row: r.row, folders: r.folders, folder };
};

// Entries live in a JSON column, so pagination is an in-memory slice of the
// order-sorted array; `total` is the full count.
export const listScheduleEntries = async (
  id: number, folderId: string, opts?: { skip?: number; take?: number }
): Promise<"not_found" | "folder_not_found" | { data: any[]; total: number }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  const sorted = [...(r.folder.entries ?? [])].sort(sortByOrder);
  const paginate = opts != null && (opts.skip != null || opts.take != null);
  const data = paginate ? sorted.slice(opts!.skip ?? 0, (opts!.skip ?? 0) + (opts!.take ?? sorted.length)) : sorted;
  return { data, total: sorted.length };
};

export const createScheduleEntry = async (id: number, folderId: string, input: { date: Date; subject: string; time: string; order?: number }): Promise<"not_found" | "folder_not_found" | "max" | { entry: any }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  if ((r.folder.entries?.length ?? 0) >= MAX_ENTRIES) return "max";
  const entry = { _id: synthId("e"), date: input.date, subject: input.subject, time: input.time, order: typeof input.order === "number" ? input.order : (r.folder.entries?.length ?? 0) };
  r.folder.entries = [...(r.folder.entries ?? []), entry];
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { entry };
};

export const updateScheduleEntry = async (id: number, folderId: string, entryId: string, patch: any): Promise<"not_found" | "folder_not_found" | "entry_not_found" | { entry: any }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  const entry = (r.folder.entries ?? []).find((e: any) => String(e._id) === entryId);
  if (!entry) return "entry_not_found";
  for (const k of ["date", "subject", "time", "order"]) if (patch[k] !== undefined) entry[k] = patch[k];
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { entry };
};

export const deleteScheduleEntry = async (id: number, folderId: string, entryId: string): Promise<"not_found" | "folder_not_found" | "entry_not_found" | true> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  if (!(r.folder.entries ?? []).some((e: any) => String(e._id) === entryId)) return "entry_not_found";
  r.folder.entries = (r.folder.entries ?? []).filter((e: any) => String(e._id) !== entryId);
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return true;
};

export const reorderScheduleEntries = async (id: number, folderId: string, entryIds: string[]): Promise<"not_found" | "folder_not_found" | "mismatch" | { entries: any[] }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  const entries = r.folder.entries ?? [];
  const have = new Set(entries.map((e: any) => String(e._id)));
  if (entryIds.length !== entries.length || entryIds.some((x) => !have.has(String(x)))) return "mismatch";
  entryIds.forEach((eid, idx) => { const e = entries.find((x: any) => String(x._id) === String(eid)); if (e) e.order = idx; });
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { entries: [...entries].sort(sortByOrder) };
};
