import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { HttpError } from "../../middlewares/errorHandler";
import { success } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  openingCreateSchema,
  openingUpdateSchema,
} from "../../modules/careers/careers.validation";
import * as careersService from "../../modules/careers/careers.service";

export const getOpeningList = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const status = req.query.status !== undefined ? req.query.status === "true" : undefined;
  const { items, total } = await careersService.listOpeningsPaged({ search, status, skip, take: limit });
  return res.status(200).json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getOpeningDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await careersService.getOpeningById(req.params.id as string);
  if (!data) throw new HttpError(404, "Career opening not found.");
  return success(res, data as unknown as object);
});

export const createOpening = asyncHandler(async (req: Request, res: Response) => {
  const validated = openingCreateSchema.parse(req.body);
  const data = await careersService.createOpening(validated);
  return res.status(201).json({ success: true, data });
});

export const updateOpening = asyncHandler(async (req: Request, res: Response) => {
  const validated = openingUpdateSchema.parse(req.body);
  const data = await careersService.updateOpening(req.params.id as string, validated);
  if (!data) throw new HttpError(404, "Career opening not found.");
  return success(res, data as unknown as object);
});

export const deleteOpening = asyncHandler(async (req: Request, res: Response) => {
  const ok = await careersService.deleteOpening(req.params.id as string);
  if (!ok) throw new HttpError(404, "Career opening not found.");
  return success(res, {}, "Career opening deleted successfully");
});
