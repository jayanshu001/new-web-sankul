// src/admin/ebook/ebook.controller.ts
//
// Thin controllers: parse + coerce → validate → call service → respond.

import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import {
  createEbookSchema,
  updateEbookSchema,
  createEbookPlanSchema,
  updateEbookPlanSchema,
  reorderEbooksSchema,
} from "./ebook.validation";
import * as ebookService from "./ebook.service";

const applyEbookUploads = (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  if (files) {
    for (const key of ["image", "thumbnail", "demoUrl", "bookUrl"] as const) {
      const url = files[key]?.[0]?.location;
      if (url) req.body[key] = url;
    }
  }
  if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
};

// ──────────────────────────────────────────────────────────────────────────────
// Ebook CRUD
// ──────────────────────────────────────────────────────────────────────────────

export const getEbooks = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await ebookService.listEbooks(
    req.query as ebookService.ListEbooksQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const getEbookById = asyncHandler(async (req: Request, res: Response) => {
  const data = await ebookService.getEbookById(req.params.id as string);
  return success(res, data as any);
});

export const createEbook = asyncHandler(async (req: Request, res: Response) => {
  applyEbookUploads(req);
  const validated = createEbookSchema.parse(req.body);
  const data = await ebookService.createEbook(validated);
  return res.status(201).json({ success: true, data });
});

export const updateEbook = asyncHandler(async (req: Request, res: Response) => {
  applyEbookUploads(req);
  const validated = updateEbookSchema.parse(req.body);
  const data = await ebookService.updateEbook(req.params.id as string, validated);
  return success(res, data as any);
});

export const deleteEbook = asyncHandler(async (req: Request, res: Response) => {
  await ebookService.deleteEbook(req.params.id as string);
  return success(res, {}, "Ebook deleted successfully");
});

export const toggleEbookTrending = asyncHandler(async (req: Request, res: Response) => {
  const data = await ebookService.toggleEbookTrending(req.params.id as string);
  return res.status(200).json({ success: true, data });
});

export const reorderEbooks = asyncHandler(async (req: Request, res: Response) => {
  const { orders } = reorderEbooksSchema.parse(req.body);
  await ebookService.reorderEbooks(orders);
  return success(res, {}, "Ebooks reordered successfully");
});

// ──────────────────────────────────────────────────────────────────────────────
// Ebook plans
// ──────────────────────────────────────────────────────────────────────────────

export const getEbookPlans = asyncHandler(async (req: Request, res: Response) => {
  const data = await ebookService.listEbookPlans(req.params.id as string);
  return res.status(200).json({ success: true, data });
});

export const createEbookPlan = asyncHandler(async (req: Request, res: Response) => {
  const validated = createEbookPlanSchema.parse(req.body);
  const data = await ebookService.createEbookPlan(req.params.id as string, validated);
  return res.status(201).json({ success: true, data });
});

export const getEbookPlanById = asyncHandler(async (req: Request, res: Response) => {
  const data = await ebookService.getEbookPlanById(req.params.planId as string);
  return success(res, data as any);
});

export const updateEbookPlan = asyncHandler(async (req: Request, res: Response) => {
  const validated = updateEbookPlanSchema.parse(req.body);
  const data = await ebookService.updateEbookPlan(req.params.planId as string, validated);
  return success(res, data as any);
});

export const deleteEbookPlan = asyncHandler(async (req: Request, res: Response) => {
  await ebookService.deleteEbookPlan(req.params.planId as string);
  return success(res, {}, "Plan deleted successfully");
});
