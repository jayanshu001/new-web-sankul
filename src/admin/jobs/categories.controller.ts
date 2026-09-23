import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import { HttpError } from "../../middlewares/errorHandler";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { categoryCreateSchema, categoryUpdateSchema, categoryReorderSchema } from "../../modules/jobs-taxonomy/category.validation";
import { parseOptionalBigInt } from "../../utils/parseId";
import * as categoryService from "../../modules/jobs-taxonomy/category.service";

const applyImageUpload = (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  const image = files?.image?.[0];
  if (image?.location) {
    req.body.imageUrl = image.location;
    req.body.imageAlt = req.body.label;
  }
};

export const getCategoryList = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const organizationId = parseOptionalBigInt(req.query.organizationId);
  const { items, total } = await categoryService.listCategoriesPaged({ search, organizationId, skip, take: limit });
  return res.status(200).json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getCategoryDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await categoryService.getCategoryById(req.params.id as string);
  if (!data) throw new HttpError(404, "Category not found.");
  return success(res, data as unknown as object);
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  applyImageUpload(req);
  const validated = categoryCreateSchema.parse(req.body);
  const data = await categoryService.createCategory(validated);
  return res.status(201).json({ success: true, data });
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  applyImageUpload(req);
  const validated = categoryUpdateSchema.parse(req.body);
  const data = await categoryService.updateCategory(req.params.id as string, validated);
  if (!data) throw new HttpError(404, "Category not found.");

  return success(res, data as unknown as object);
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const ok = await categoryService.deleteCategory(req.params.id as string);
  if (!ok) throw new HttpError(404, "Category not found.");
  return success(res, {}, "Category deleted successfully");
});

export const reorderCategories = asyncHandler(async (req: Request, res: Response) => {
  const { orders } = categoryReorderSchema.parse(req.body);
  await categoryService.reorderCategories(orders);
  return success(res, {}, "Categories reordered successfully");
});
