import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Inquiry } from "../../models/system/Inquiry.model";
import { isMysqlModule } from "../../config/migration";
import {
  listDepartments as listDepartmentsService,
  createDepartment as createDepartmentService,
  updateDepartment as updateDepartmentService,
  deleteDepartment as deleteDepartmentService,
  parseDepartmentId,
} from "../../modules/department/department.service";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GET /api/v1/admin/inquiries
export const listInquiries = async (req: Request, res: Response) => {
  try {
    const { search, course, mode, fromDate, toDate, page = "1", limit = "20" } =
      req.query as Record<string, string>;

    const filter: any = {};
    if (course) filter.course = course;
    if (mode) filter.mode = mode;
    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Inquiry.find(filter)
        .populate("customerId", "_id firstName lastName phoneNumber email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Inquiry.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
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
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await Inquiry.findById(id)
      .populate("customerId", "_id firstName lastName phoneNumber email")
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/admin/inquiries/:id
export const deleteInquiry = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await Inquiry.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
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

// Data access delegated to department service (MySQL/Prisma when listed in
// MIGRATION_MYSQL_MODULES, Mongo otherwise). API JSON shape preserved.
const departmentIdInvalid = (id: string) =>
  isMysqlModule("department") ? !parseDepartmentId(id) : !isObjectId(id);

export const listDepartments = async (_req: Request, res: Response) => {
  try {
    const data = await listDepartmentsService();
    return res.status(200).json({ success: true, data });
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
