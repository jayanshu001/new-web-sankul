import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { AdminUser } from "../../models/admin/AdminUser.model";
import { Role } from "../../models/admin/Role.model";
import { AdminAccessToken } from "../../models/admin/AdminAccessToken.model";
import { AdminRole } from "../../models/enums";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import {
  createAdministratorSchema,
  updateAdministratorSchema,
} from "./administrator.validation";

const SALT_ROUNDS = 10;

const ADMIN_ROLE_VALUES = Object.values(AdminRole) as string[];

const PUBLIC_FIELDS =
  "_id firstName lastName email role roles permissions image status isDark emailVerifiedAt lastLoginDate lastLoginIp lastSeenAt createdAt updatedAt";

// ─── List ─────────────────────────────────────────────────────────────────────

export const getAdministrators = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      role,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filters: any = {};

    if (search) {
      filters.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") filters.status = status === "true";
    if (role) {
      if (ADMIN_ROLE_VALUES.includes(role)) filters.role = role;
      else if (mongoose.Types.ObjectId.isValid(role)) filters.roles = role;
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      AdminUser.find(filters)
        .select(PUBLIC_FIELDS)
        .populate("roles", "_id name guardName")
        .populate("permissions", "_id name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      AdminUser.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get by ID ────────────────────────────────────────────────────────────────

export const getAdministratorById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    const admin = await AdminUser.findById(id)
      .select(PUBLIC_FIELDS)
      .populate("roles", "_id name guardName")
      .populate("permissions", "_id name");

    if (!admin) {
      return res.status(404).json({ success: false, message: "Administrator not found" });
    }

    return res.status(200).json({ success: true, data: admin });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Pre-requisites (roles dropdown) ─────────────────────────────────────────

export const getAdministratorPreRequisites = async (_req: Request, res: Response) => {
  try {
    const roles = await Role.find().select("_id name guardName").sort({ name: 1 });
    const builtInRoles = ADMIN_ROLE_VALUES.map((r) => ({ value: r, label: r }));
    return res.status(200).json({
      success: true,
      data: { roles, builtInRoles },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const createAdministrator = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    const data = createAdministratorSchema.parse(req.body);

    const exists = await AdminUser.findOne({ email: data.email.toLowerCase() });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Administrator with this email already exists.",
      });
    }

    const payload: any = {
      firstName: data.firstName,
      lastName: data.lastName ?? undefined,
      email: data.email.toLowerCase(),
      password: await bcrypt.hash(data.password, SALT_ROUNDS),
      status: data.status,
      isDark: data.isDark,
      image: data.image ?? undefined,
    };

    if (data.role) {
      if (ADMIN_ROLE_VALUES.includes(data.role)) {
        payload.role = data.role;
      } else {
        payload.roles = [data.role];
      }
    }

    const created = await AdminUser.create(payload);

    const result = await AdminUser.findById(created._id)
      .select(PUBLIC_FIELDS)
      .populate("roles", "_id name guardName")
      .populate("permissions", "_id name");

    return res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Email already in use." });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateAdministrator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    const data = updateAdministratorSchema.parse(req.body);

    const admin = await AdminUser.findById(id);
    if (!admin) {
      return res.status(404).json({ success: false, message: "Administrator not found" });
    }

    if (data.email && data.email.toLowerCase() !== admin.email) {
      const emailExists = await AdminUser.exists({
        email: data.email.toLowerCase(),
        _id: { $ne: id },
      });
      if (emailExists) {
        return res.status(409).json({ success: false, message: "Email already in use." });
      }
      admin.email = data.email.toLowerCase();
    }

    if (data.firstName !== undefined) admin.firstName = data.firstName;
    if (data.lastName !== undefined) admin.lastName = data.lastName ?? undefined;
    if (data.status !== undefined) admin.status = data.status;
    if (data.isDark !== undefined) admin.isDark = data.isDark;

    if (data.password) {
      admin.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    }

    if (data.role) {
      if (ADMIN_ROLE_VALUES.includes(data.role)) {
        admin.role = data.role as AdminRole;
      } else {
        admin.roles = [data.role as any];
      }
    }

    if (data.image !== undefined) {
      if (admin.image && admin.image !== data.image) {
        deleteFromS3FileUrl(admin.image).catch(() => {});
      }
      admin.image = data.image ?? undefined;
    }

    await admin.save();

    const result = await AdminUser.findById(admin._id)
      .select(PUBLIC_FIELDS)
      .populate("roles", "_id name guardName")
      .populate("permissions", "_id name");

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteAdministrator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    if (req.user?.id === id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account.",
      });
    }

    const admin = await AdminUser.findById(id);
    if (!admin) {
      return res.status(404).json({ success: false, message: "Administrator not found" });
    }

    if (admin.image) {
      deleteFromS3FileUrl(admin.image).catch(() => {});
    }

    await AdminAccessToken.updateMany(
      { adminUserId: admin._id },
      { active: false, deleted: true }
    );

    await admin.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Administrator deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Toggle Status ────────────────────────────────────────────────────────────

export const toggleAdministratorStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    if (req.user?.id === id) {
      return res.status(400).json({
        success: false,
        message: "You cannot disable your own account.",
      });
    }

    const admin = await AdminUser.findById(id).select("status");
    if (!admin) {
      return res.status(404).json({ success: false, message: "Administrator not found" });
    }

    admin.status = !admin.status;
    await admin.save();

    if (!admin.status) {
      await AdminAccessToken.updateMany(
        { adminUserId: admin._id },
        { active: false, deleted: true }
      );
    }

    return res.status(200).json({ success: true, data: { status: admin.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
