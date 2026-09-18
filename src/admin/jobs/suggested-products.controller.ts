import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import { HttpError } from "../../middlewares/errorHandler";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  suggestedProductCreateSchema,
  suggestedProductUpdateSchema,
} from "../../modules/jobs-suggested-products/suggested-product.validation";
import * as suggestedProductService from "../../modules/jobs-suggested-products/suggested-product.service";
import type { JobSuggestedPlacement } from "../../modules/jobs-suggested-products/suggested-product.types";

export const getSuggestedProductList = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const placementType = req.query.placementType as JobSuggestedPlacement | undefined;
  const { items, total } = await suggestedProductService.listSuggestedProductsPaged({
    placementType,
    skip,
    take: limit,
  });
  return res.status(200).json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getSuggestedProductDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await suggestedProductService.getSuggestedProductById(req.params.id as string);
  if (!data) throw new HttpError(404, "Suggested product not found.");
  return success(res, data as unknown as object);
});

export const createSuggestedProduct = asyncHandler(async (req: Request, res: Response) => {
  const validated = suggestedProductCreateSchema.parse(req.body);
  const data = await suggestedProductService.createSuggestedProduct(validated);
  return res.status(201).json({ success: true, data });
});

export const updateSuggestedProduct = asyncHandler(async (req: Request, res: Response) => {
  const validated = suggestedProductUpdateSchema.parse(req.body);
  const data = await suggestedProductService.updateSuggestedProduct(req.params.id as string, validated);
  if (!data) throw new HttpError(404, "Suggested product not found.");
  return success(res, data as unknown as object);
});

export const deleteSuggestedProduct = asyncHandler(async (req: Request, res: Response) => {
  const ok = await suggestedProductService.deleteSuggestedProduct(req.params.id as string);
  if (!ok) throw new HttpError(404, "Suggested product not found.");
  return success(res, {}, "Suggested product deleted successfully");
});
