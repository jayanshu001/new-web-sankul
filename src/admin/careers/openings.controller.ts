import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { HttpError } from "../../middlewares/errorHandler";
import { success } from "../../utils/httpResponse";
import { buildPagination, parseListQuery } from "../../utils/listQuery";
import {
  openingCreateSchema,
  openingUpdateSchema,
} from "../../modules/careers/careers.validation";
import * as careersService from "../../modules/careers/careers.service";
import { OPENING_NOT_FOUND, orNotFound } from "./careers.helpers";

export const getOpeningList = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, {
    defaultLimit: 20,
    maxLimit: 100,
  });
  const status = req.query.status === undefined ? undefined : req.query.status === "true";

  const { items, total } = await careersService.listOpeningsPaged({
    search,
    status,
    skip,
    take: limit,
  });

  return res.status(200).json({
    success: true,
    data: items,
    pagination: buildPagination(total, page, limit),
  });
});

export const getOpeningDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await careersService.getOpeningById(req.params.id as string);

  return success(res, orNotFound(data, OPENING_NOT_FOUND));
});

export const createOpening = asyncHandler(async (req: Request, res: Response) => {
  const data = await careersService.createOpening(openingCreateSchema.parse(req.body));

  return res.status(201).json({ success: true, data });
});

export const updateOpening = asyncHandler(async (req: Request, res: Response) => {
  const data = await careersService.updateOpening(
    req.params.id as string,
    openingUpdateSchema.parse(req.body)
  );

  return success(res, orNotFound(data, OPENING_NOT_FOUND));
});

export const deleteOpening = asyncHandler(async (req: Request, res: Response) => {
  const deleted = await careersService.deleteOpening(req.params.id as string);
  if (!deleted) throw new HttpError(404, OPENING_NOT_FOUND);

  return success(res, {}, "Career opening deleted successfully");
});
