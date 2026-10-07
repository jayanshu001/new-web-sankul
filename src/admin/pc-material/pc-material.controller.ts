// Admin PC materials: HTTP handlers for the PC material master CRUD.
import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { HttpError } from "../../middlewares/errorHandler";
import {
  createPcMaterialSchema,
  updatePcMaterialSchema,
} from "./pc-material.validation";
import * as master from "../../modules/admin-master/admin-master.service";

export const listPcMaterials = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit } = req.query as Record<string, string>;
  // Pagination is opt-in (page/limit); otherwise the full list for dropdown callers.
  // `search` applies in both modes.
  const paginate = page !== undefined || limit !== undefined;
  const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
  const { data, total } = await master.pcmList({
    search,
    ...(paginate ? { skip: (pageNum - 1) * limitNum, take: limitNum } : {}),
  });
  return res.status(200).json(
    paginate
      ? { success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } }
      : { success: true, data }
  );
});

export const getPcMaterialById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const numId = master.parseMasterId(id);
  if (!numId) throw new HttpError(400, "Invalid material id.");
  const data = await master.pcmGet(numId);
  if (!data) throw new HttpError(404, "Material not found.");
  return res.status(200).json({ success: true, data });
});

export const createPcMaterial = asyncHandler(async (req: Request, res: Response) => {
  const validated = createPcMaterialSchema.parse(req.body);
  return res.status(201).json({ success: true, data: await master.pcmCreate(validated.title) });
});

export const updatePcMaterial = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const validated = updatePcMaterialSchema.parse(req.body);
  const numId = master.parseMasterId(id);
  if (!numId) throw new HttpError(400, "Invalid material id.");
  const data = await master.pcmUpdate(numId, validated.title ?? "");
  if (!data) throw new HttpError(404, "Material not found.");
  return res.status(200).json({ success: true, data });
});

export const deletePcMaterial = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const numId = master.parseMasterId(id);
  if (!numId) throw new HttpError(400, "Invalid material id.");
  if (!(await master.pcmDelete(numId))) throw new HttpError(404, "Material not found.");
  return res.status(200).json({ success: true, message: "Material deleted." });
});
