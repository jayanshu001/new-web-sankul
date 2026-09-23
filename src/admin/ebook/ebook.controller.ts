// src/admin/ebook/ebook.controller.ts
//
// Thin controllers: parse + coerce → validate → call service → respond.

import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import { HttpError } from "../../middlewares/errorHandler";
import { parseListQuery } from "../../utils/listQuery";
import { listPromocodesForScope } from "../../modules/promo-code/promo-code.service";
import {
  createEbookSchema,
  updateEbookSchema,
  createEbookPlanSchema,
  updateEbookPlanSchema,
  reorderEbooksSqlSchema,
} from "./ebook.validation";
import * as ebookService from "./ebook.service";

const NAME_FIELD_BY_URL = {
  demoUrl: "demoFileName",
  bookUrl: "bookFileName",
} as const;

const applyEbookUploads = (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  if (files) {
    for (const key of ["image", "thumbnail", "demoUrl", "bookUrl"] as const) {
      const file = files[key]?.[0];
      if (file?.location) {
        req.body[key] = file.location;
        const nameField = (NAME_FIELD_BY_URL as Record<string, string>)[key];
        if (nameField) req.body[nameField] = file.originalname ?? null;
      }
    }
  }
  // A cleared PDF slot must clear its file name too. The multipart form sends ""
  // but the admin UI's Remove button sends JSON `null` (there is no File in the
  // payload, so the request isn't multipart at all) — both mean "cleared".
  for (const urlField of ["demoUrl", "bookUrl"] as const) {
    const url = req.body[urlField];
    if (url === "" || url === null) {
      req.body[NAME_FIELD_BY_URL[urlField]] = null;
    }
  }
  if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  if (typeof req.body.isPaid === "string") req.body.isPaid = req.body.isPaid === "true";
  coerceArrayFields(req);
};

// Multipart form-data flattens `field[0]=a&field[1]=b` (and the bare
// `field[]=a&field[]=b` form) into literal keys; reassemble them into a real
// array before validation. The Zod schema also accepts a JSON-stringified
// array or single string, so this only handles the bracketed-key form.
const ARRAY_BODY_FIELDS = ["examCountdownCategoryIds", "examCountdownIds"] as const;

const coerceArrayFields = (req: Request) => {
  const body = req.body as Record<string, any>;
  for (const field of ARRAY_BODY_FIELDS) {
    if (Array.isArray(body[field])) continue;
    const bracketKeys = Object.keys(body).filter((k) => k.startsWith(`${field}[`));
    if (!bracketKeys.length) continue;
    const arr = bracketKeys.map((k) => {
      const v = body[k];
      delete body[k];
      return v;
    });
    body[field] = arr.filter((v) => v !== "");
  }
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
  // On SQL ids are numeric. Shape is { orders: [{ id, order }] }.
  const { orders } = reorderEbooksSqlSchema.parse(req.body);
  await ebookService.reorderEbooks(orders);
  return success(res, {}, "Ebooks reordered successfully");
});

// ──────────────────────────────────────────────────────────────────────────────
// Ebook plans
// ──────────────────────────────────────────────────────────────────────────────

export const getEbookPlans = asyncHandler(async (req: Request, res: Response) => {
  const q = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
  const { data, pagination } = await ebookService.listEbookPlans(req.params.id as string, {
    skip: q.skip,
    take: q.limit,
    page: q.page,
    limit: q.limit,
  });
  return res.status(200).json({ success: true, data, pagination });
});

export const getEbookPromocodes = asyncHandler(async (req: Request, res: Response) => {
  const ebookId = ebookService.parseEbookId(req.params.id as string);
  if (!ebookId) throw new HttpError(400, "Invalid Ebook ID");
  const q = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
  const { data, pagination } = await listPromocodesForScope("ebook", ebookId, q);
  return res.status(200).json({ success: true, data, pagination });
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
