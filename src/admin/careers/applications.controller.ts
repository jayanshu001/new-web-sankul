import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { HttpError } from "../../middlewares/errorHandler";
import { success } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  applicationListQuerySchema,
  applicationStatusUpdateSchema,
} from "../../modules/careers/careers.validation";
import * as careersService from "../../modules/careers/careers.service";

export const getApplicationList = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { openingId, status } = applicationListQuerySchema.parse(req.query);
  const { items, total } = await careersService.listApplicationsPaged({
    openingId: openingId !== undefined ? String(openingId) : undefined,
    status,
    skip,
    take: limit,
  });
  return res.status(200).json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getApplicationDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await careersService.getApplicationById(req.params.id as string);
  if (!data) throw new HttpError(404, "Application not found.");
  return success(res, data as unknown as object);
});

export const updateApplicationStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = applicationStatusUpdateSchema.parse(req.body);
  const data = await careersService.updateApplicationStatus(req.params.id as string, status);
  if (!data) throw new HttpError(404, "Application not found.");
  return success(res, data as unknown as object);
});
