import { Request, Response } from "express";
import {
  createRoleSchema,
  updateRoleSchema,
  listQuerySchema,
  guardOnlyQuerySchema,
  syncPermissionsSchema,
} from "./role.validation";
import * as rbac from "../../modules/admin-rbac/admin-rbac.service";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

// GET /api/v1/admin/roles
export const listRoles = async (req: Request, res: Response) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { guard, search, page, per_page, sort_by, sort_dir } = parsed.data;

    const { items, total } = await rbac.listRoles({ guard, search, page, per_page, sort_by, sort_dir });
    return res.status(200).json({ success: true, data: { items, pagination: { page, per_page, total } } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/roles/:id
export const getRole = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
    if (!guardParsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(guardParsed.error.issues),
      });
    }

    const numId = rbac.parseRbacId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid role id" });
    const sqlRole = await rbac.getRole(numId, guardParsed.data.guard);
    if (!sqlRole) return res.status(404).json({ success: false, message: "Role not found" });
    return res.status(200).json({ success: true, data: sqlRole });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/admin/roles
export const createRole = async (req: Request, res: Response) => {
  try {
    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { name, guard, permission_ids } = parsed.data;

    if (await rbac.roleNameExists(name, guard)) {
      return res.status(409).json({ success: false, message: `Role '${name}' already exists for guard '${guard}'` });
    }
    const validIds = await rbac.validatePermissionIds(permission_ids, guard);
    if (validIds === null) {
      return res.status(422).json({ success: false, message: `One or more permission_ids are invalid or do not belong to guard '${guard}'` });
    }
    const data = await rbac.createRole(name, guard, validIds);
    return res.status(201).json({ success: true, message: "Role created successfully", data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/v1/admin/roles/:id
export const updateRole = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }

    const numId = rbac.parseRbacId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid role id" });
    const existing = await rbac.getRole(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Role not found" });
    const nextName = parsed.data.name ?? existing.name;
    const nextGuard = parsed.data.guard ?? existing.guard_name;
    if ((nextName !== existing.name || nextGuard !== existing.guard_name) && (await rbac.roleNameExists(nextName, nextGuard))) {
      return res.status(409).json({ success: false, message: `Role '${nextName}' already exists for guard '${nextGuard}'` });
    }
    let nextIds: bigint[] | undefined;
    if (parsed.data.permission_ids) {
      const valid = await rbac.validatePermissionIds(parsed.data.permission_ids, nextGuard);
      if (valid === null) return res.status(422).json({ success: false, message: `One or more permission_ids are invalid or do not belong to guard '${nextGuard}'` });
      nextIds = valid;
    } else if (parsed.data.guard && parsed.data.guard !== existing.guard_name) {
      nextIds = []; // guard changed, no list → clear stale refs
    }
    const data = await rbac.updateRole(numId, { name: nextName, guard: nextGuard, permissionIds: nextIds });
    return res.status(200).json({ success: true, message: "Role updated successfully", data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/v1/admin/roles/:id
export const deleteRole = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
    if (!guardParsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(guardParsed.error.issues),
      });
    }

    const numId = rbac.parseRbacId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid role id" });
    const role = await rbac.getRole(numId, guardParsed.data.guard);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    if (await rbac.roleInUse(numId)) {
      return res.status(409).json({ success: false, message: "Role is assigned to one or more users and cannot be deleted" });
    }
    await rbac.deleteRole(numId);
    return res.status(200).json({ success: true, message: "Role deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/roles/:id/permissions
export const getRolePermissions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
    if (!guardParsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(guardParsed.error.issues),
      });
    }

    const numId = rbac.parseRbacId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid role id" });
    const result = await rbac.getRolePermissions(numId, guardParsed.data.guard);
    if (!result) return res.status(404).json({ success: false, message: "Role not found" });
    return res.status(200).json({ success: true, data: { assigned: result.assigned, unassigned: result.unassigned } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/v1/admin/roles/:id/permissions
export const syncRolePermissions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = syncPermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }

    const numId = rbac.parseRbacId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid role id" });
    const existing = await rbac.getRole(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Role not found" });
    if (parsed.data.guard && parsed.data.guard !== existing.guard_name) {
      return res.status(422).json({ success: false, message: `Provided guard '${parsed.data.guard}' does not match role guard '${existing.guard_name}'` });
    }
    const valid = await rbac.validatePermissionIds(parsed.data.permission_ids, existing.guard_name);
    if (valid === null) return res.status(422).json({ success: false, message: `One or more permission_ids are invalid or do not belong to guard '${existing.guard_name}'` });
    const data = await rbac.syncRolePermissions(numId, valid);
    return res.status(200).json({ success: true, message: "Permissions synced successfully", data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
