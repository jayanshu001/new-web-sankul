import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { AdminRole } from "../../models/enums";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import {
  createAdministratorSchema,
  updateAdministratorSchema,
} from "./administrator.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as adminSql from "../../modules/admin-auth/administrator.service";

const SALT_ROUNDS = 10;

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

    const roles = await adminSql.listAssignableRoles();
    logger.info("getAdministratorPreRequisites success (sql)", { traceId, roleCount: roles.length });
    return res.status(200).json({ success: true, data: { roles, builtInRoles } });
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
  } catch (error: any) {
    logger.error("toggleAdministratorStatus failed", { traceId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
