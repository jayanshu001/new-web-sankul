// Admin educators: HTTP handlers for educator CRUD, details and associated products.
import { Request, Response } from "express";
import { createEducatorSchema, updateEducatorSchema } from "./master.validation";
import bcrypt from "bcryptjs";
import { educatorAuthRepository as eduRepo } from "../../modules/educator-auth/educator-auth.repository";
import { toEducatorListDto } from "../../modules/educator-auth/educator-auth.transformer";
import {
  getEducatorAssociations,
  listEducatorCourses,
  listEducatorLiveCourses,
  listEducatorPackages,
  listEducatorVideoCategories,
  listEducatorLiveSessions,
} from "../../modules/educator-auth/educator-details.service";

const EDUCATOR_SORT_FIELDS = new Set(["createdAt", "updatedAt", "name", "email"]);

const parseEducatorIntId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const parseEducatorStatus = (status?: string): boolean | undefined => {
  if (status === "true" || status === "active") return true;
  if (status === "false" || status === "inactive") return false;
  return undefined;
};

export const getEducators = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      sortBy,
      sortOrder,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const sortField = sortBy && EDUCATOR_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";

    const statusFilter = parseEducatorStatus(status);
    const sortDirSql = sortOrder === "asc" ? "asc" : "desc";
    const [rows, total] = await Promise.all([
      eduRepo.listAdmin({
        search,
        status: statusFilter,
        sortBy: sortField,
        sortDir: sortDirSql,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      eduRepo.countAdmin({ search, status: statusFilter }),
    ]);
    return res.status(200).json({
      success: true,
      data: rows.map(toEducatorListDto),
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createEducator = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = createEducatorSchema.parse(req.body);

    if (await eduRepo.emailInUse(validatedData.email)) {
      return res.status(409).json({ success: false, message: "Educator with this email already exists." });
    }
    // password column is NOT NULL; hash when provided, else store "" (no login).
    const password = validatedData.password
      ? await bcrypt.hash(validatedData.password, 10)
      : "";
    const created = await eduRepo.createAdmin({
      name: validatedData.name,
      email: validatedData.email,
      password,
      image: validatedData.image,
      about: validatedData.about,
      status: validatedData.status,
    });
    return res.status(201).json({ success: true, data: toEducatorListDto(created) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEducator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = updateEducatorSchema.parse(req.body);

    const numId = parseEducatorIntId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    const existing = await eduRepo.findById(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Educator not found" });

    if (validatedData.email && (await eduRepo.emailInUse(validatedData.email, numId))) {
      return res.status(409).json({ success: false, message: "Email already in use." });
    }
    const password = validatedData.password
      ? await bcrypt.hash(validatedData.password, 10)
      : undefined;
    const updated = await eduRepo.updateAdmin(numId, {
      name: validatedData.name,
      email: validatedData.email,
      password,
      image: validatedData.image,
      about: validatedData.about,
      status: validatedData.status,
    });
    return res.status(200).json({ success: true, data: toEducatorListDto(updated) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getEducatorById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = parseEducatorIntId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    const row = await eduRepo.findById(numId);
    if (!row) return res.status(404).json({ success: false, message: "Educator not found" });
    return res.status(200).json({ success: true, data: toEducatorListDto(row) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEducatorDetails = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Profile + associations (courses/live-courses/packages/video-categories/sessions);
    // DTO shape is frozen for existing clients.
    const numId = parseEducatorIntId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    const row = await eduRepo.findById(numId);
    if (!row) return res.status(404).json({ success: false, message: "Educator not found" });
    const { associations, summary } = await getEducatorAssociations(numId);
    return res.status(200).json({
      success: true,
      data: { profile: toEducatorListDto(row), associations, summary },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const parseEducatorPaging = (req: Request) => {
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 500);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum, take: limitNum };
};
const educatorPageMeta = (total: number, pageNum: number, limitNum: number) => ({
  total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum),
});

type EducatorListFn = (educatorId: number, args: { skip: number; take: number }) => Promise<{ data: unknown[]; total: number }>;

// Builds a paged handler for one of an educator's associated product lists (404 if no educator).
const educatorListHandler = (fn: EducatorListFn) => async (req: Request, res: Response) => {
  try {
    const numId = parseEducatorIntId(req.params.id as string);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    const existing = await eduRepo.findById(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Educator not found" });

    const { pageNum, limitNum, skip, take } = parseEducatorPaging(req);
    const { data, total } = await fn(numId, { skip, take });
    return res.status(200).json({ success: true, data, pagination: educatorPageMeta(total, pageNum, limitNum) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEducatorCourses = educatorListHandler(listEducatorCourses);
export const getEducatorLiveCourses = educatorListHandler(listEducatorLiveCourses);
export const getEducatorPackages = educatorListHandler(listEducatorPackages);
export const getEducatorVideoCategories = educatorListHandler(listEducatorVideoCategories);
export const getEducatorLiveSessions = educatorListHandler(listEducatorLiveSessions);

export const deleteEducator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = parseEducatorIntId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    const existing = await eduRepo.findById(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Educator not found" });
    // No `deleted` column: disable + revoke tokens, retain the row.
    await eduRepo.disableAdmin(numId);
    return res.status(200).json({ success: true, message: "Educator deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
