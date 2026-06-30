import { Request, Response } from "express";
import { createEducatorSchema, updateEducatorSchema } from "./master.validation";
import bcrypt from "bcryptjs";
import { educatorAuthRepository as eduRepo } from "../../modules/educator-auth/educator-auth.repository";
import { toEducatorListDto } from "../../modules/educator-auth/educator-auth.transformer";
import { getEducatorAssociations } from "../../modules/educator-auth/educator-details.service";

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

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
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

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
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

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
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

// ─── Educator Details (aggregate for admin detail page) ──────────────────────

export const getEducatorDetails = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
    // Profile + associations (courses/live-courses/packages/video-categories/
    // sessions) all from SQL, matching the Mongo handler's DTO shape exactly.
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

export const deleteEducator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
    const numId = parseEducatorIntId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    const existing = await eduRepo.findById(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Educator not found" });
    // No `deleted` column in SQL → disable + revoke tokens, retain the row.
    await eduRepo.disableAdmin(numId);
    return res.status(200).json({ success: true, message: "Educator deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
