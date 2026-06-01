// src/admin/live-course/live-course.controller.ts
//
// Thin controllers: coerce multipart → validate (Zod) → delegate to service.
// Validation 422 keeps the legacy `{ errors: string[] }` shape because the
// admin React dashboard already binds to it.

import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success, failure } from "../../utils/httpResponse";
import {
  createLiveCourseSchema,
  updateLiveCourseSchema,
} from "./live-course.validation";
import * as liveCourseService from "./live-course.service";

// In multipart submissions (when an image file is uploaded), array fields
// arrive as JSON-stringified strings. Parse them back to arrays so Zod's
// `.strict()` schema accepts them. Leaves real arrays untouched.
const parseJsonArray = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s.startsWith("[")) return v;
  try { const parsed = JSON.parse(s); return Array.isArray(parsed) ? parsed : v; } catch { return v; }
};

const coerceBody = (body: Record<string, any>): Record<string, any> => {
  const out = { ...body };
  if (typeof out.ordered === "string") out.ordered = Number(out.ordered);
  if (typeof out.status === "string") out.status = out.status === "true";
  if (typeof out.isPaid === "string") out.isPaid = out.isPaid === "true";
  if (typeof out.isPopular === "string") out.isPopular = out.isPopular === "true";
  if (out.examCountdownCategoryIds !== undefined)
    out.examCountdownCategoryIds = parseJsonArray(out.examCountdownCategoryIds);
  if (out.examCountdownIds !== undefined)
    out.examCountdownIds = parseJsonArray(out.examCountdownIds);
  if (out.materialCategories !== undefined)
    out.materialCategories = parseJsonArray(out.materialCategories);
  if (out.examCategories !== undefined)
    out.examCategories = parseJsonArray(out.examCategories);
  return out;
};

const zodIssueResponse = (res: Response, err: z.ZodError) => {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
};

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

export const createLiveCourse = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file as any;
  if (file?.location) req.body.image = file.location;

  let validated: z.infer<typeof createLiveCourseSchema>;
  try {
    validated = createLiveCourseSchema.parse(coerceBody(req.body));
  } catch (err) {
    if (err instanceof z.ZodError) return zodIssueResponse(res, err);
    throw err;
  }

  const data = await liveCourseService.createLiveCourse(validated, req.user?.id);
  return success(res, data, "Live course created with default folder.", 201);
});

export const listLiveCourses = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.listLiveCourses(
    req.query as liveCourseService.ListLiveCoursesQuery
  );
  return success(res, data, "Live courses fetched.");
});

export const getLiveCourseById = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.getLiveCourseById(req.params.id as string);
  return success(res, data as any, "Live course fetched.");
});

export const updateLiveCourse = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file as any;
  if (file?.location) req.body.image = file.location;

  let validated: z.infer<typeof updateLiveCourseSchema>;
  try {
    validated = updateLiveCourseSchema.parse(coerceBody(req.body));
  } catch (err) {
    if (err instanceof z.ZodError) return zodIssueResponse(res, err);
    throw err;
  }

  const data = await liveCourseService.updateLiveCourse(
    req.params.id as string,
    validated
  );
  return success(res, data, "Live course updated.");
});

export const deleteLiveCourse = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.deleteLiveCourse(req.params.id as string);
  return success(res, data, "Live course deleted.");
});

export const toggleLiveCoursePopular = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.toggleLiveCoursePopular(req.params.id as string);
  return success(res, data, "Popular flag toggled.");
});

// ──────────────────────────────────────────────────────────────────────────────
// Sessions + timetable files
// ──────────────────────────────────────────────────────────────────────────────

export const listSessionsForLiveCourse = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await liveCourseService.listSessionsForLiveCourse(
      req.params.id as string,
      req.query as liveCourseService.ListSessionsQuery
    );
    return success(res, data, "Sessions fetched.");
  }
);

// ──────────────────────────────────────────────────────────────────────────────
// Schedule folders + entries
// ──────────────────────────────────────────────────────────────────────────────

const folderCreateSchema = z
  .object({
    title:  z.string().trim().min(1, "title is required").max(80),
    image:  z.string().trim().max(2048).nullable().optional(),
    order:  z.number().int().min(0).optional(),
    status: z.boolean().optional(),
  })
  .strict();

const folderPatchSchema = z
  .object({
    title:  z.string().trim().min(1, "title is required").max(80).optional(),
    image:  z.string().trim().max(2048).nullable().optional(),
    order:  z.number().int().min(0).optional(),
    status: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "At least one field is required." });

const folderReorderSchema = z
  .object({ folderIds: z.array(z.string().min(1)).min(1) })
  .strict();

const entryCreateSchema = z
  .object({
    date:    z.coerce.date(),
    subject: z.string().trim().min(1, "subject is required").max(120),
    time:    z.string().trim().min(1, "time is required").max(40),
    order:   z.number().int().min(0).optional(),
  })
  .strict();

const entryPatchSchema = z
  .object({
    date:    z.coerce.date().optional(),
    subject: z.string().trim().min(1, "subject is required").max(120).optional(),
    time:    z.string().trim().min(1, "time is required").max(40).optional(),
    order:   z.number().int().min(0).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "At least one field is required." });

const entryReorderSchema = z
  .object({ entryIds: z.array(z.string().min(1)).min(1) })
  .strict();

const parseWith = <T extends z.ZodTypeAny>(schema: T, body: unknown, res: Response):
  | { ok: true; value: z.infer<T> }
  | { ok: false } => {
  try {
    return { ok: true, value: schema.parse(body) };
  } catch (err) {
    if (err instanceof z.ZodError) {
      zodIssueResponse(res, err);
      return { ok: false };
    }
    throw err;
  }
};

export const listScheduleFolders = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.listScheduleFolders(req.params.id as string);
  return success(res, data, "Schedule folders fetched.");
});

export const createScheduleFolder = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseWith(folderCreateSchema, req.body, res);
  if (!parsed.ok) return;
  const data = await liveCourseService.createScheduleFolder(req.params.id as string, parsed.value);
  return success(res, data, "Schedule folder created.", 201);
});

export const updateScheduleFolder = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseWith(folderPatchSchema, req.body, res);
  if (!parsed.ok) return;
  const data = await liveCourseService.updateScheduleFolder(
    req.params.id as string,
    req.params.folderId as string,
    parsed.value
  );
  return success(res, data, "Schedule folder updated.");
});

export const deleteScheduleFolder = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.deleteScheduleFolder(
    req.params.id as string,
    req.params.folderId as string
  );
  return success(res, data, "Schedule folder deleted.");
});

export const reorderScheduleFolders = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseWith(folderReorderSchema, req.body, res);
  if (!parsed.ok) return;
  const data = await liveCourseService.reorderScheduleFolders(
    req.params.id as string,
    parsed.value.folderIds
  );
  return success(res, data, "Schedule folders reordered.");
});

export const listScheduleEntries = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.listScheduleEntries(
    req.params.id as string,
    req.params.folderId as string
  );
  return success(res, data, "Schedule entries fetched.");
});

export const createScheduleEntry = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseWith(entryCreateSchema, req.body, res);
  if (!parsed.ok) return;
  const data = await liveCourseService.createScheduleEntry(
    req.params.id as string,
    req.params.folderId as string,
    parsed.value
  );
  return success(res, data, "Schedule entry created.", 201);
});

export const updateScheduleEntry = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseWith(entryPatchSchema, req.body, res);
  if (!parsed.ok) return;
  const data = await liveCourseService.updateScheduleEntry(
    req.params.id as string,
    req.params.folderId as string,
    req.params.entryId as string,
    parsed.value
  );
  return success(res, data, "Schedule entry updated.");
});

export const deleteScheduleEntry = asyncHandler(async (req: Request, res: Response) => {
  const data = await liveCourseService.deleteScheduleEntry(
    req.params.id as string,
    req.params.folderId as string,
    req.params.entryId as string
  );
  return success(res, data, "Schedule entry deleted.");
});

export const reorderScheduleEntries = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseWith(entryReorderSchema, req.body, res);
  if (!parsed.ok) return;
  const data = await liveCourseService.reorderScheduleEntries(
    req.params.id as string,
    req.params.folderId as string,
    parsed.value.entryIds
  );
  return success(res, data, "Schedule entries reordered.");
});

// Deprecated: old flat schedule-entries PATCH. Frontend has migrated to the
// folder-grouped endpoints above. Return 410 Gone so legacy callers get a
// clear signal rather than silent success.
export const updateScheduleEntriesDeprecated = asyncHandler(async (_req: Request, res: Response) => {
  return failure(
    res,
    "PATCH /schedule-entries has been removed. Use /schedule-folders and /schedule-folders/:folderId/entries.",
    410
  );
});
