// src/admin/permission/permission.controller.ts
//
// Thin controllers. Validation responses keep the existing 422 + `errors` map
// shape that the admin React dashboard already consumes (see legacy
// controller); switching to the centralized failure() envelope would be a
// client-facing breaking change.

import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import {
  createPermissionSchema,
  updatePermissionSchema,
  listQuerySchema,
  guardOnlyQuerySchema,
} from "./permission.validation";
import * as permissionService from "./permission.service";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

export const listPermissions = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: formatZodErrors(parsed.error.issues),
    });
  }
  const data = await permissionService.listPermissions(parsed.data);
  return res.status(200).json({ success: true, data });
});

export const getPermission = asyncHandler(async (req: Request, res: Response) => {
  const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
  if (!guardParsed.success) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: formatZodErrors(guardParsed.error.issues),
    });
  }
  const data = await permissionService.getPermission(
    req.params.id as string,
    guardParsed.data.guard
  );
  return res.status(200).json({ success: true, data });
});

export const createPermission = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createPermissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: formatZodErrors(parsed.error.issues),
    });
  }
  const data = await permissionService.createPermission(parsed.data);
  return res
    .status(201)
    .json({ success: true, message: "Permission created successfully", data });
});

export const updatePermission = asyncHandler(async (req: Request, res: Response) => {
  const parsed = updatePermissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: formatZodErrors(parsed.error.issues),
    });
  }
  const data = await permissionService.updatePermission(
    req.params.id as string,
    parsed.data
  );
  return res
    .status(200)
    .json({ success: true, message: "Permission updated successfully", data });
});

export const deletePermission = asyncHandler(async (req: Request, res: Response) => {
  const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
  if (!guardParsed.success) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: formatZodErrors(guardParsed.error.issues),
    });
  }
  await permissionService.deletePermission(
    req.params.id as string,
    guardParsed.data.guard
  );
  return res
    .status(200)
    .json({ success: true, message: "Permission deleted successfully", data: {} });
});

export const getRolesForPermission = asyncHandler(async (req: Request, res: Response) => {
  const guardParsed = guardOnlyQuerySchema.safeParse(req.query);
  if (!guardParsed.success) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: formatZodErrors(guardParsed.error.issues),
    });
  }
  const data = await permissionService.getRolesForPermission(
    req.params.id as string,
    guardParsed.data.guard
  );
  return res.status(200).json({ success: true, data });
});

export const getPermissionsTree = asyncHandler(async (_req: Request, res: Response) => {
  const data = await permissionService.getPermissionsTree();
  return res.status(200).json({ success: true, data });
});
