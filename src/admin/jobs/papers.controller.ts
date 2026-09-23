import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import { HttpError } from "../../middlewares/errorHandler";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { parseOptionalBigInt } from "../../utils/parseId";
import { paperWriteSchema, paperUpdateSchema } from "../../modules/jobs-papers/paper.validation";
import * as paperService from "../../modules/jobs-papers/paper.service";
import type { JobPaperStatus, JobPaperTier } from "../../modules/jobs-papers/paper.types";

const JSON_BODY_FIELDS = ["files", "jobIds", "tags", "products"] as const;

const parseJsonBodyFields = (req: Request) => {
  const body = req.body as Record<string, unknown>;
  for (const field of JSON_BODY_FIELDS) {
    if (typeof body[field] === "string" && body[field]) {
      try {
        body[field] = JSON.parse(body[field] as string);
      } catch {
        throw new HttpError(422, `Invalid JSON for field: ${field}`);
      }
    }
  }
};

const applyPreviewUpload = (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  const preview = files?.previewImage?.[0];
  if (preview?.location) {
    req.body.previewUrl = preview.location;
  }
};

export const getPaperList = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const status = req.query.status as JobPaperStatus | undefined;
  const tier = req.query.tier as JobPaperTier | undefined;
  const organizationId = parseOptionalBigInt(req.query.organizationId);
  const categoryId = parseOptionalBigInt(req.query.categoryId);
  const { items, total } = await paperService.listPapersPaged({
    status,
    tier,
    organizationId,
    categoryId,
    search,
    skip,
    take: limit,
  });
  return res.status(200).json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getPaperDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await paperService.getPaperById(req.params.id as string);
  if (!data) throw new HttpError(404, "Previous paper not found.");
  return success(res, data as unknown as object);
});

export const createPaper = asyncHandler(async (req: Request, res: Response) => {
  parseJsonBodyFields(req);
  applyPreviewUpload(req);
  const validated = paperWriteSchema.parse(req.body);
  const data = await paperService.createPaper(validated);
  return res.status(201).json({ success: true, data });
});

export const updatePaper = asyncHandler(async (req: Request, res: Response) => {
  parseJsonBodyFields(req);
  applyPreviewUpload(req);
  const validated = paperUpdateSchema.parse(req.body);
  const data = await paperService.updatePaper(req.params.id as string, validated);
  if (!data) throw new HttpError(404, "Previous paper not found.");

  return success(res, data as unknown as object);
});

export const deletePaper = asyncHandler(async (req: Request, res: Response) => {
  const ok = await paperService.deletePaper(req.params.id as string);
  if (!ok) throw new HttpError(404, "Previous paper not found.");
  return success(res, {}, "Previous paper deleted successfully");
});

/** Multi-file PDF upload proxy (small files). Large PDFs should use the
 * presigned `jobPreviousPaperPdf` flow via POST /admin/uploads/presign. */
export const uploadPaperFiles = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.MulterS3.File[] | undefined) ?? [];
  const uploaded = files.filter((f) => f.location).map((f) => ({ label: f.originalname, url: f.location }));
  return success(res, { files: uploaded });
});
