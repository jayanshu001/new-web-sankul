// src/admin/package/package.controller.ts
//
// Thin controllers: parse + coerce → validate → call service → respond.
// Errors flow through the global `errorHandler` via `asyncHandler`; services
// throw `HttpError(code, message)` for predictable status codes.

import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import {
  createPackageSchema,
  updatePackageSchema,
  reorderPackagesSchema,
  reorderEmbeddedSchema,
  attachPlansSchema,
  createPackageTypeSchema,
  updatePackageTypeSchema,
  createChatMessageSchema,
  setRelationsSchema,
} from "./package.validation";
import * as packageService from "./package.service";

// ──────────────────────────────────────────────────────────────────────────────
// Multipart coercion helper
// ──────────────────────────────────────────────────────────────────────────────

const coercePackageBody = (req: Request) => {
  const file = req.file as any;
  if (file?.location) req.body.image = file.location;
  if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
  if (typeof req.body.active === "string") req.body.active = req.body.active === "true";
  if (typeof req.body.isMagazine === "string")
    req.body.isMagazine = req.body.isMagazine === "true";
  if (typeof req.body.isPaid === "string") req.body.isPaid = req.body.isPaid === "true";
  if (typeof req.body.isSmartCourse === "string")
    req.body.isSmartCourse = req.body.isSmartCourse === "true";
  if (typeof req.body.isPlannerCourse === "string")
    req.body.isPlannerCourse = req.body.isPlannerCourse === "true";
};

// ──────────────────────────────────────────────────────────────────────────────
// Package Types
// ──────────────────────────────────────────────────────────────────────────────

export const listPackageTypes = asyncHandler(async (_req: Request, res: Response) => {
  const data = await packageService.listPackageTypes();
  return res.status(200).json({ success: true, data });
});

export const createPackageType = asyncHandler(async (req: Request, res: Response) => {
  const validated = createPackageTypeSchema.parse(req.body);
  const data = await packageService.createPackageType(validated);
  return res.status(201).json({ success: true, data });
});

export const updatePackageType = asyncHandler(async (req: Request, res: Response) => {
  const validated = updatePackageTypeSchema.parse(req.body);
  const data = await packageService.updatePackageType(req.params.id as string, validated);
  return success(res, data as any);
});

export const deletePackageType = asyncHandler(async (req: Request, res: Response) => {
  await packageService.deletePackageType(req.params.id as string);
  return success(res, {}, "Package type deleted.");
});

// ──────────────────────────────────────────────────────────────────────────────
// Packages CRUD
// ──────────────────────────────────────────────────────────────────────────────

export const listPackages = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await packageService.listPackages(
    req.query as packageService.ListPackagesQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const getPackageById = asyncHandler(async (req: Request, res: Response) => {
  const data = await packageService.getPackageById(req.params.id as string);
  return success(res, data as any);
});

export const createPackage = asyncHandler(async (req: Request, res: Response) => {
  coercePackageBody(req);
  const validated = createPackageSchema.parse(req.body);
  const data = await packageService.createPackage(validated);
  return res.status(201).json({ success: true, data });
});

export const updatePackage = asyncHandler(async (req: Request, res: Response) => {
  coercePackageBody(req);
  const validated = updatePackageSchema.parse(req.body);
  const data = await packageService.updatePackage(req.params.id as string, validated);
  return success(res, data as any);
});

export const deletePackage = asyncHandler(async (req: Request, res: Response) => {
  await packageService.deletePackage(req.params.id as string);
  return success(res, {}, "Package deleted.");
});

export const togglePackageStatus = asyncHandler(async (req: Request, res: Response) => {
  const data = await packageService.togglePackageStatus(req.params.id as string);
  return res.status(200).json({ success: true, data });
});

export const reorderPackages = asyncHandler(async (req: Request, res: Response) => {
  const { orders } = reorderPackagesSchema.parse(req.body);
  await packageService.reorderPackages(orders);
  return success(res, {}, "Package order updated.");
});

// ──────────────────────────────────────────────────────────────────────────────
// Embedded reorders
// ──────────────────────────────────────────────────────────────────────────────

export const reorderSpecificSubjects = asyncHandler(async (req: Request, res: Response) => {
  const { orders } = reorderEmbeddedSchema.parse(req.body);
  const data = await packageService.reorderEmbedded(
    req.params.id as string,
    "specificSubjects",
    orders
  );
  return res.status(200).json({ success: true, data });
});

export const reorderMaterialCategories = asyncHandler(
  async (req: Request, res: Response) => {
    const { orders } = reorderEmbeddedSchema.parse(req.body);
    const data = await packageService.reorderEmbedded(
      req.params.id as string,
      "materialCategories",
      orders
    );
    return res.status(200).json({ success: true, data });
  }
);

export const reorderExamCategories = asyncHandler(async (req: Request, res: Response) => {
  const { orders } = reorderEmbeddedSchema.parse(req.body);
  const data = await packageService.reorderEmbedded(
    req.params.id as string,
    "examCategories",
    orders
  );
  return res.status(200).json({ success: true, data });
});

// ──────────────────────────────────────────────────────────────────────────────
// Plans
// ──────────────────────────────────────────────────────────────────────────────

export const listPackagePlans = asyncHandler(async (req: Request, res: Response) => {
  const data = await packageService.listPackagePlans(req.params.id as string);
  return res.status(200).json({ success: true, data });
});

export const attachPlans = asyncHandler(async (req: Request, res: Response) => {
  const { planIds } = attachPlansSchema.parse(req.body);
  const { modified } = await packageService.attachPlansToPackage(
    req.params.id as string,
    planIds
  );
  return res.status(200).json({ success: true, modified });
});

export const detachPlan = asyncHandler(async (req: Request, res: Response) => {
  await packageService.detachPlan(
    req.params.id as string,
    req.params.planId as string
  );
  return res.status(200).json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Subscribers / Promoted / Relations
// ──────────────────────────────────────────────────────────────────────────────

export const listSubscribers = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await packageService.listSubscribers(
    req.params.id as string,
    req.query as packageService.PaginationQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const listPromotedCodes = asyncHandler(async (req: Request, res: Response) => {
  const data = await packageService.listPromotedCodes(req.params.id as string);
  return res.status(200).json({ success: true, data });
});

export const listVideoRelations = asyncHandler(async (req: Request, res: Response) => {
  const data = await packageService.listVideoRelations(req.params.id as string);
  return res.status(200).json({ success: true, data });
});

export const setVideoRelations = asyncHandler(async (req: Request, res: Response) => {
  const { videoCategoryRelationIds } = setRelationsSchema.parse(req.body);
  const { count } = await packageService.setVideoRelations(
    req.params.id as string,
    videoCategoryRelationIds
  );
  return res.status(200).json({ success: true, count });
});

export const expandSubjectsToRelations = asyncHandler(
  async (req: Request, res: Response) => {
    const { count } = await packageService.expandSubjectsToRelations(
      req.params.id as string
    );
    return res.status(200).json({ success: true, count });
  }
);

// ──────────────────────────────────────────────────────────────────────────────
// Chat
// ──────────────────────────────────────────────────────────────────────────────

export const listChatMessages = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await packageService.listChatMessages(
    req.params.id as string,
    req.query as packageService.PaginationQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const postChatMessage = asyncHandler(async (req: Request, res: Response) => {
  const validated = createChatMessageSchema.parse(req.body);
  const adminId = (req as any).user?.id;
  const data = await packageService.postChatMessage(
    req.params.id as string,
    validated,
    adminId
  );
  return res.status(201).json({ success: true, data });
});

export const deleteChatMessage = asyncHandler(async (req: Request, res: Response) => {
  await packageService.deleteChatMessage(req.params.messageId as string);
  return success(res, {}, "Message deleted.");
});
