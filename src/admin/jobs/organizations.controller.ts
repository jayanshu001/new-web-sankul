import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import { HttpError } from "../../middlewares/errorHandler";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { createMediaFromUpload, deleteMediaById, parseMediaId } from "../../modules/jobs-media/media.service";
import { organizationCreateSchema, organizationUpdateSchema } from "../../modules/jobs-taxonomy/organization.validation";
import * as organizationService from "../../modules/jobs-taxonomy/organization.service";

const applyLogoUpload = async (req: Request) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  const logo = files?.logo?.[0];
  if (logo?.location) {
    const media = await createMediaFromUpload({ url: logo.location, altText: req.body.name });
    req.body.logoMediaId = media._id;
  }
};

export const getOrganizationList = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { items, total } = await organizationService.listOrganizationsPaged({ search, skip, take: limit });
  return res.status(200).json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getOrganizationDetail = asyncHandler(async (req: Request, res: Response) => {
  const data = await organizationService.getOrganizationById(req.params.id as string);
  if (!data) throw new HttpError(404, "Organization not found.");
  return success(res, data as unknown as object);
});

export const createOrganization = asyncHandler(async (req: Request, res: Response) => {
  await applyLogoUpload(req);
  const validated = organizationCreateSchema.parse(req.body);
  const data = await organizationService.createOrganization(validated);
  return res.status(201).json({ success: true, data });
});

export const updateOrganization = asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  const replacingLogo = Boolean(files?.logo?.[0]);
  const previous = replacingLogo ? await organizationService.getOrganizationById(req.params.id as string) : null;

  await applyLogoUpload(req);
  const validated = organizationUpdateSchema.parse(req.body);
  const data = await organizationService.updateOrganization(req.params.id as string, validated);
  if (!data) throw new HttpError(404, "Organization not found.");

  if (replacingLogo && previous?.logo) await deleteMediaById(parseMediaId(previous.logo._id));

  return success(res, data as unknown as object);
});

export const deleteOrganization = asyncHandler(async (req: Request, res: Response) => {
  const ok = await organizationService.deleteOrganization(req.params.id as string);
  if (!ok) throw new HttpError(404, "Organization not found.");
  return success(res, {}, "Organization deleted successfully");
});
