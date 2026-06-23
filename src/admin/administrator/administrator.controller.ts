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
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildSearchFilter } from "../../utils/searchFilter";
import { isMysqlModule } from "../../config/migration";
import * as adminSql from "../../modules/admin-auth/administrator.service";

const SALT_ROUNDS = 10;
const MODULE = "admin-auth";

const ADMIN_ROLE_VALUES = Object.values(AdminRole) as string[];

/** Coerce the `status` query param to a boolean filter (or undefined). */
const parseStatusFilter = (status?: string): boolean | undefined => {
  if (status === "true" || status === "active") return true;
  if (status === "false" || status === "inactive") return false;
  return undefined;
};

/**
 * On the SQL branch the only persistable role is a numeric spatie role id
 * (ws_roles.id). The legacy built-in enum roles (super_admin/admin/editor)
 * have no SQL column, so they are ignored for storage and derived on read.
 */
const resolveSqlRoleId = (role?: string | null): bigint | undefined => {
  if (!role || ADMIN_ROLE_VALUES.includes(role)) return undefined;
  return adminSql.parseAdminBigId(role) ?? undefined;
};

const PUBLIC_FIELDS =
  "_id firstName lastName email role roles permissions image status isDark emailVerifiedAt lastLoginDate lastLoginIp lastSeenAt createdAt updatedAt";

// ─── List ─────────────────────────────────────────────────────────────────────

export const getAdministrators = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getAdministrators invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const {
      search,
      status,
      role,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    // ─── MySQL branch (ws_users) ──────────────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const { items, total } = await adminSql.listAdministrators({
        search,
        status: parseStatusFilter(status),
        roleId: role && !ADMIN_ROLE_VALUES.includes(role) ? role : undefined,
        page: pageNum,
        limit: limitNum,
      });
      logger.info("getAdministrators success (sql)", { traceId, total });
      return res.status(200).json({
        success: true,
        data: {
          items,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
          },
        },
      });
    }

    // Soft-deleted admins are never listed.
    const filters: any = { deleted: false };

    Object.assign(filters, buildSearchFilter(search, ["firstName", "lastName", "email"]));
    // Accept boolean ("true"/"false") and label ("active"/"inactive") forms.
    if (status === "true" || status === "active") filters.status = true;
    else if (status === "false" || status === "inactive") filters.status = false;
    if (role) {
      if (ADMIN_ROLE_VALUES.includes(role)) filters.role = role;
      else if (mongoose.Types.ObjectId.isValid(role)) filters.roles = role;
    }

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

    logger.info("getAdministrators success", { traceId, total });
    return res.status(200).json({
      success: true,
      data: {
        items: data,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error: any) {
    logger.error("getAdministrators failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get by ID ────────────────────────────────────────────────────────────────

export const getAdministratorById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getAdministratorById invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    // ─── MySQL branch (ws_users) ──────────────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const bigId = adminSql.parseAdminBigId(id);
      if (!bigId) {
        logger.warn("getAdministratorById invalid id (sql)", { traceId, id });
        return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
      }
      const adminDto = await adminSql.getAdministrator(bigId);
      if (!adminDto) {
        logger.warn("getAdministratorById not found (sql)", { traceId, id });
        return res.status(404).json({ success: false, message: "Administrator not found" });
      }
      logger.info("getAdministratorById success (sql)", { traceId, id });
      return res.status(200).json({ success: true, data: adminDto });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getAdministratorById invalid id", { traceId, id });
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    const admin = await AdminUser.findOne({ _id: id, deleted: false })
      .select(PUBLIC_FIELDS)
      .populate("roles", "_id name guardName")
      .populate("permissions", "_id name");

    if (!admin) {
      logger.warn("getAdministratorById not found", { traceId, id });
      return res.status(404).json({ success: false, message: "Administrator not found" });
    }

    logger.info("getAdministratorById success", { traceId, id });
    return res.status(200).json({ success: true, data: admin });
  } catch (error: any) {
    logger.error("getAdministratorById failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Pre-requisites (roles dropdown) ─────────────────────────────────────────

export const getAdministratorPreRequisites = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getAdministratorPreRequisites invoked", { traceId, path: _req.originalUrl });

  try {
    const builtInRoles = ADMIN_ROLE_VALUES.map((r) => ({ value: r, label: r }));

    // ─── MySQL branch (ws_roles) ──────────────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const roles = await adminSql.listAssignableRoles();
      logger.info("getAdministratorPreRequisites success (sql)", { traceId, roleCount: roles.length });
      return res.status(200).json({ success: true, data: { roles, builtInRoles } });
    }

    const roles = await Role.find().select("_id name guardName").sort({ name: 1 });
    logger.info("getAdministratorPreRequisites success", { traceId, roleCount: roles.length });
    return res.status(200).json({
      success: true,
      data: { roles, builtInRoles },
    });
  } catch (error: any) {
    logger.error("getAdministratorPreRequisites failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const createAdministrator = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createAdministrator invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    const data = createAdministratorSchema.parse(req.body);

    // ─── MySQL branch (ws_users) ──────────────────────────────────────────
    if (isMysqlModule(MODULE)) {
      if (await adminSql.emailInUse(data.email)) {
        logger.warn("createAdministrator email conflict (sql)", { traceId, email: data.email });
        return res.status(409).json({
          success: false,
          message: "Administrator with this email already exists.",
        });
      }

      const roleId = resolveSqlRoleId(data.role);
      if (roleId !== undefined && !(await adminSql.roleExists(roleId))) {
        logger.warn("createAdministrator unknown role (sql)", { traceId, role: data.role });
        return res.status(400).json({ success: false, message: "Invalid role id." });
      }

      const result = await adminSql.createAdministrator({
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        email: data.email,
        passwordHash: await bcrypt.hash(data.password, SALT_ROUNDS),
        image: data.image ?? "",
        status: data.status,
        isDark: data.isDark,
        roleId,
      });

      logger.info("createAdministrator success (sql)", { traceId, adminId: result._id, email: result.email });
      return res.status(201).json({ success: true, data: result });
    }

    // Only non-deleted admins block the email; a soft-deleted one frees it.
    const exists = await AdminUser.findOne({ email: data.email.toLowerCase(), deleted: false });
    if (exists) {
      logger.warn("createAdministrator email conflict", { traceId, email: data.email });
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

    logger.info("createAdministrator success", { traceId, adminId: created._id, email: created.email });
    return res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) { logger.warn("createAdministrator validation failed", { traceId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    if (error.code === 11000) {
      logger.warn("createAdministrator duplicate email", { traceId });
      return res.status(409).json({ success: false, message: "Email already in use." });
    }
    logger.error("createAdministrator failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateAdministrator = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("updateAdministrator invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    const data = updateAdministratorSchema.parse(req.body);

    // ─── MySQL branch (ws_users) ──────────────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const bigId = adminSql.parseAdminBigId(id);
      if (!bigId) {
        logger.warn("updateAdministrator invalid id (sql)", { traceId, id });
        return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
      }

      const existing = await adminSql.getAdministrator(bigId);
      if (!existing) {
        logger.warn("updateAdministrator not found (sql)", { traceId, id });
        return res.status(404).json({ success: false, message: "Administrator not found" });
      }

      if (data.email && data.email.toLowerCase() !== existing.email) {
        if (await adminSql.emailInUse(data.email, bigId)) {
          logger.warn("updateAdministrator email in use (sql)", { traceId, id, email: data.email });
          return res.status(409).json({ success: false, message: "Email already in use." });
        }
      }

      const roleId = resolveSqlRoleId(data.role);
      if (roleId !== undefined && !(await adminSql.roleExists(roleId))) {
        logger.warn("updateAdministrator unknown role (sql)", { traceId, role: data.role });
        return res.status(400).json({ success: false, message: "Invalid role id." });
      }

      // Replace the old S3 image when a new one is supplied (best-effort).
      if (data.image !== undefined && existing.image && existing.image !== data.image) {
        deleteFromS3FileUrl(existing.image).catch(() => {});
      }

      const result = await adminSql.updateAdministrator(bigId, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        passwordHash: data.password ? await bcrypt.hash(data.password, SALT_ROUNDS) : undefined,
        image: data.image ?? undefined,
        status: data.status,
        isDark: data.isDark,
        roleId,
      });

      logger.info("updateAdministrator success (sql)", { traceId, id });
      return res.status(200).json({ success: true, data: result });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("updateAdministrator invalid id", { traceId, id });
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    const admin = await AdminUser.findOne({ _id: id, deleted: false });
    if (!admin) {
      logger.warn("updateAdministrator not found", { traceId, id });
      return res.status(404).json({ success: false, message: "Administrator not found" });
    }

    if (data.email && data.email.toLowerCase() !== admin.email) {
      const emailExists = await AdminUser.exists({
        email: data.email.toLowerCase(),
        _id: { $ne: id },
        deleted: false,
      });
      if (emailExists) {
        logger.warn("updateAdministrator email in use", { traceId, id, email: data.email });
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

    logger.info("updateAdministrator success", { traceId, id });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) { logger.warn("updateAdministrator validation failed", { traceId, id, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("updateAdministrator failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteAdministrator = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("deleteAdministrator invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    if (req.user?.id === id) {
      logger.warn("deleteAdministrator self delete refused", { traceId, id });
      return res.status(403).json({
        success: false,
        message: "You cannot delete your own account.",
      });
    }

    // ─── MySQL branch (ws_users) ──────────────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const bigId = adminSql.parseAdminBigId(id);
      if (!bigId) {
        logger.warn("deleteAdministrator invalid id (sql)", { traceId, id });
        return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
      }
      const existing = await adminSql.getAdministrator(bigId);
      if (!existing) {
        logger.warn("deleteAdministrator not found (sql)", { traceId, id });
        return res.status(404).json({ success: false, message: "Administrator not found" });
      }
      if (existing.image) deleteFromS3FileUrl(existing.image).catch(() => {});
      // ws_users has no soft-delete column → hard delete the row (+ tokens and
      // spatie role/permission pivots) so it disappears from the list.
      await adminSql.deleteAdministrator(bigId);
      logger.info("deleteAdministrator success (sql)", { traceId, id });
      return res.status(200).json({
        success: true,
        message: "Administrator deleted successfully",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("deleteAdministrator invalid id", { traceId, id });
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    const admin = await AdminUser.findOne({ _id: id, deleted: false });
    if (!admin) {
      logger.warn("deleteAdministrator not found", { traceId, id });
      return res.status(404).json({ success: false, message: "Administrator not found" });
    }

    if (admin.image) {
      deleteFromS3FileUrl(admin.image).catch(() => {});
    }

    await AdminAccessToken.updateMany(
      { adminUserId: admin._id },
      { active: false, deleted: true }
    );

    // Soft delete: retain the row (for audit trail / historical references) but
    // mark it deleted + disabled so it's excluded from login, list, and detail.
    // The partial unique index frees the email for re-registration.
    admin.deleted = true;
    admin.status = false;
    await admin.save();

    logger.info("deleteAdministrator success", { traceId, id });
    return res.status(200).json({
      success: true,
      message: "Administrator deleted successfully",
    });
  } catch (error: any) {
    logger.error("deleteAdministrator failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Toggle Status ────────────────────────────────────────────────────────────

export const toggleAdministratorStatus = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("toggleAdministratorStatus invoked", { traceId, path: req.originalUrl, id, userId: req.user?.id });

  try {
    if (req.user?.id === id) {
      logger.warn("toggleAdministratorStatus self disable refused", { traceId, id });
      return res.status(400).json({
        success: false,
        message: "You cannot disable your own account.",
      });
    }

    // ─── MySQL branch (ws_users) ──────────────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const bigId = adminSql.parseAdminBigId(id);
      if (!bigId) {
        logger.warn("toggleAdministratorStatus invalid id (sql)", { traceId, id });
        return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
      }
      const existing = await adminSql.getAdministrator(bigId);
      if (!existing) {
        logger.warn("toggleAdministratorStatus not found (sql)", { traceId, id });
        return res.status(404).json({ success: false, message: "Administrator not found" });
      }
      const newStatus = !existing.status;
      await adminSql.setAdministratorStatus(bigId, newStatus);
      logger.info("toggleAdministratorStatus success (sql)", { traceId, id, newStatus });
      return res.status(200).json({ success: true, data: { status: newStatus } });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("toggleAdministratorStatus invalid id", { traceId, id });
      return res.status(400).json({ success: false, message: "Invalid Administrator ID" });
    }

    const admin = await AdminUser.findOne({ _id: id, deleted: false }).select("status");
    if (!admin) {
      logger.warn("toggleAdministratorStatus not found", { traceId, id });
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

    logger.info("toggleAdministratorStatus success", { traceId, id, newStatus: admin.status });
    return res.status(200).json({ success: true, data: { status: admin.status } });
  } catch (error: any) {
    logger.error("toggleAdministratorStatus failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
