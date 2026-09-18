import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import { HttpError } from "../../middlewares/errorHandler";
import { parseListQuery } from "../../utils/listQuery";
import { buildPagination } from "../../utils/listQuery";
import { parseOptionalBigInt } from "../../utils/parseId";
import { createMediaFromUpload, deleteMediaById, parseMediaId } from "../../modules/jobs-media/media.service";
import {
  contentWriteSchema,
  contentUpdateSchema,
  contentStatusSchema,
  contentReorderSchema,
} from "../../modules/jobs-content/content.validation";
import * as contentService from "../../modules/jobs-content/content.service";
import { resolveContentType } from "../../modules/jobs-content/content.service";
import type { JobContentDto, JobContentStatus } from "../../modules/jobs-content/content.types";
import { scheduleContentPublish, cancelScheduledPublish } from "./jobs.scheduler";

/** Arms/cancels the delayed publish job so a "scheduled" save actually flips
 * to published at its publishedAt time (nothing else does this). */
const syncScheduledPublish = async (data: JobContentDto) => {
  if (data.status === "scheduled" && data.publishedAt) {
    await scheduleContentPublish(data._id, new Date(data.publishedAt));
  } else {
    await cancelScheduledPublish(data._id);
  }
};

// Repeater/nested fields arrive as JSON-stringified multipart fields so the
// admin editor can send arbitrary-depth objects/arrays in one form-data POST.
const JSON_BODY_FIELDS = [
  "categoryIds",
  "seo",
  "facts",
  "products",
  "sections",
  "relatedPostIds",
  "jobFields",
  "admitCardFields",
  "resultFields",
  "answerKeyFields",
  "otherFields",
  "examCalendarFields",
  "syllabusFields",
] as const;

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

const applyContentUploads = async (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  const featuredImage = files?.featuredImage?.[0];
  if (featuredImage?.location) {
    const media = await createMediaFromUpload({ url: featuredImage.location, altText: req.body.title });
    req.body.featuredImageId = media._id;
  }
  const ogImage = files?.ogImage?.[0];
  if (ogImage?.location) {
    const media = await createMediaFromUpload({ url: ogImage.location });
    const body = req.body as { seo?: Record<string, unknown> };
    body.seo = { ...(body.seo ?? {}), ogImageId: media._id };
  }
};

export const getContentList = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const type = resolveContentType(req.query.type as string | undefined);
  const status = req.query.status as JobContentStatus | undefined;
  const organizationId = parseOptionalBigInt(req.query.organizationId);
  const categoryId = parseOptionalBigInt(req.query.categoryId);
  const { items, total } = await contentService.listContentPaged({
    type,
    status,
    organizationId,
    categoryId,
    search,
    skip,
    take: limit,
  });
  return res.status(200).json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getContentDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await contentService.getContentById(req.params.id as string);
  if (!data) throw new HttpError(404, "Job content not found.");
  return success(res, data as unknown as object);
});

export const createContent = asyncHandler(async (req: Request, res: Response) => {
  parseJsonBodyFields(req);
  await applyContentUploads(req);
  const validated = contentWriteSchema.parse(req.body);
  const data = await contentService.createContent(validated);
  await syncScheduledPublish(data);
  return res.status(201).json({ success: true, data });
});

export const updateContent = asyncHandler(async (req: Request, res: Response) => {
  parseJsonBodyFields(req);
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  const replacingFeatured = Boolean(files?.featuredImage?.[0]);
  const replacingOg = Boolean(files?.ogImage?.[0]);
  const previous =
    replacingFeatured || replacingOg ? await contentService.getContentById(req.params.id as string) : null;

  await applyContentUploads(req);
  const validated = contentUpdateSchema.parse(req.body);
  const data = await contentService.updateContent(req.params.id as string, validated);
  if (!data) throw new HttpError(404, "Job content not found.");
  await syncScheduledPublish(data);

  // Best-effort: clean up the S3 file + Media row the new upload just replaced.
  if (replacingFeatured && previous?.featuredImage) await deleteMediaById(parseMediaId(previous.featuredImage._id));
  if (replacingOg && previous?.seo?.ogImage) await deleteMediaById(parseMediaId(previous.seo.ogImage._id));

  return success(res, data as unknown as object);
});

export const deleteContent = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const ok = await contentService.deleteContent(id);
  if (!ok) throw new HttpError(404, "Job content not found.");
  await cancelScheduledPublish(id);
  return success(res, {}, "Job content deleted successfully");
});

export const setContentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = contentStatusSchema.parse(req.body);
  const data = await contentService.setContentStatus(req.params.id as string, status);
  if (!data) throw new HttpError(404, "Job content not found.");
  await syncScheduledPublish(data);
  return success(res, data as unknown as object);
});

export const reorderContent = asyncHandler(async (req: Request, res: Response) => {
  const { orders } = contentReorderSchema.parse(req.body);
  await contentService.reorderContent(orders);
  return success(res, {}, "Job content reordered successfully");
});

export const uploadInlineImage = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file as Express.MulterS3.File | undefined;
  if (!file?.location) throw new HttpError(422, "No image file received.");
  return success(res, { url: file.location });
});

export const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file as Express.MulterS3.File | undefined;
  if (!file?.location) throw new HttpError(422, "No document file received.");
  return success(res, { url: file.location });
});
