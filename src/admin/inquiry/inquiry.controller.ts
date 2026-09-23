import { Request, Response } from "express";
import { z } from "zod";
import {
  parseInquiryId,
  listInquiries as sqlListInquiries, getInquiry as sqlGetInquiry, deleteInquiry as sqlDeleteInquiry,
} from "../../modules/inquiry/inquiry.service";
import {
  listDepartments as listDepartmentsService,
  createDepartment as createDepartmentService,
  updateDepartment as updateDepartmentService,
  deleteDepartment as deleteDepartmentService,
  parseDepartmentId,
} from "../../modules/department/department.service";

// GET /api/v1/admin/inquiries
export const listInquiries = async (req: Request, res: Response) => {
  try {
    const { search, course, mode, fromDate, toDate, page = "1", limit = "20" } =
      req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const { data, total } = await sqlListInquiries({
      search: search || undefined, course: course || undefined, mode: mode || undefined,
      from: fromDate ? new Date(fromDate) : undefined, to: toDate ? new Date(toDate) : undefined,
      page: pageNum, limit: limitNum,
    });
    return res.status(200).json({
      success: true, data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/inquiries/:id
export const getInquiry = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseInquiryId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = await sqlGetInquiry(nid);
    if (!data) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/admin/inquiries/:id
export const deleteInquiry = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseInquiryId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await sqlDeleteInquiry(nid);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Inquiry deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Department management (used by contact-us screen) ─────────────────────────

const contactSchema = z.object({
  mobile: z.string().min(1).max(20),
  order: z.number().int().default(0),
  active: z.boolean().default(true),
  // MySQL `ws_department_contact` flags (additive vs the legacy Mongo shape).
  isCallAvailable: z.boolean().optional(),
  isWhatsAppAvailable: z.boolean().optional(),
});
const departmentCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  order: z.number().int().default(0),
  active: z.boolean().default(true),
  contacts: z.array(contactSchema).optional().default([]),
});
const departmentUpdateSchema = departmentCreateSchema.partial();

// Data access delegated to department service (MySQL/Prisma). API JSON shape preserved.
const departmentIdInvalid = (id: string) => !parseDepartmentId(id);

export const listDepartments = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "10", active } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
    // `active` filters by status: "true"/"false". Omit (undefined) for all.
    const activeFilter = active === undefined ? undefined : active === "true";

    const { items, total } = await listDepartmentsService({
      page: pageNum,
      limit: limitNum,
      active: activeFilter,
    });

    return res.status(200).json({
      success: true,
      data: items,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createDepartment = async (req: Request, res: Response) => {
  try {
    const data = departmentCreateSchema.parse(req.body);
    const doc = await createDepartmentService(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (departmentIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = departmentUpdateSchema.parse(req.body);
    const doc = await updateDepartmentService(id, data);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (departmentIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await deleteDepartmentService(id);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Department deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
