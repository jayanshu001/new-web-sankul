import { Request, Response } from "express";
import {
  listFaqsPaged as listFaqsPagedService,
  getFaqById,
  createFaq as createFaqService,
  updateFaq as updateFaqService,
  deleteFaq as deleteFaqService,
  listFaqTypes as listFaqTypesService,
  parseFaqId,
  resolveFaqTypeFilter,
  FAQ_TYPE_FILTER_MESSAGE,
} from "../../modules/faq/faq.service";
import {
  faqCreateSchemaMysql,
  faqUpdateSchemaMysql,
} from "../../modules/faq/faq.validation";
import {
  listPopupsPaged as listPopupsPagedService,
  getPopupById as getPopupByIdService,
  createPopup as createPopupService,
  updatePopup as updatePopupService,
  deletePopup as deletePopupService,
  parsePopupId,
} from "../../modules/popup/popup.service";
import {
  listBannersPaged as listBannersPagedService,
  getBannerById as getBannerByIdService,
  createBanner as createBannerService,
  updateBanner as updateBannerService,
  deleteBanner as deleteBannerService,
  reorderBanners as reorderBannersService,
  parseBannerId,
} from "../../modules/banner-slider/banner-slider.service";
import {
  listTestimonialsPaged as listTestimonialsPagedService,
  getTestimonialById as getTestimonialByIdService,
  createTestimonial as createTestimonialService,
  updateTestimonial as updateTestimonialService,
  deleteTestimonial as deleteTestimonialService,
  parseTestimonialId,
} from "../../modules/testimonial/testimonial.service";
import {
  listTerms as listTermsService,
  getTermsById as getTermsByIdService,
  createTerms as createTermsService,
  updateTerms as updateTermsService,
  deleteTerms as deleteTermsService,
  parseTermsId,
  isTermsConflict,
} from "../../modules/terms/terms.service";
import {
  termsCreateSchemaMysql,
  termsUpdateSchemaMysql,
} from "../../modules/terms/terms.validation";
import {
  getVersionSettings,
  upsertVersionSettings,
} from "../../modules/version/version.service";
import {
  getAppUpdateSettings,
  upsertAppUpdateSettings,
} from "../../modules/app-update/app-update.service";
import {
  faqTypeCreateSchema,
  faqTypeUpdateSchema,
  popupCreateSchema,
  popupUpdateSchema,
  bannerCreateSchema,
  bannerUpdateSchema,
  liveBannerCreateSchema,
  liveBannerUpdateSchema,
  testimonialCreateSchema,
  testimonialUpdateSchema,
  versionUpsertSchema,
  appUpdateUpsertSchema,
  socialLinkCreateSchema,
  socialLinkUpdateSchema,
  socialLinkTypeCreateSchema,
  socialLinkTypeUpdateSchema,
  currentAffairCreateSchema,
  currentAffairUpdateSchema,
  reorderSchema,
} from "./cms.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { z } from "zod";
import * as cmsx from "../../modules/cms/cms-extra.service";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { FAQ_TYPES, FAQ_TYPE_LABELS } from "../../modules/faq/faq.types";

// Parse the standard admin list query: search/page/limit (via parseListQuery)
// plus sortBy/sortOrder. `sortBy` stays a raw string — each service whitelists
// its own sortable columns and falls back to that resource's default ordering.
const parseSort = (query: Record<string, any>): { sortBy?: string; sortDir?: "asc" | "desc" } => {
  const sortBy = typeof query.sortBy === "string" && query.sortBy ? query.sortBy : undefined;
  const sortDir = query.sortOrder === "asc" ? "asc" : query.sortOrder === "desc" ? "desc" : undefined;
  return { sortBy, sortDir };
};

// Resolve search + sort + opt-in pagination for an admin list endpoint.
// `skip`/`take` are only set when `page` or `limit` is present in the query, so
// callers absent of pagination params still get the full filtered list (the
// pagination block is then omitted from the response — back-compat with the
// flat-array contract the FE relied on previously).
const parseAdminList = (query: Record<string, any>) => {
  const { search, page, limit, skip } = parseListQuery(query);
  const { sortBy, sortDir } = parseSort(query);
  const paginate = query.page !== undefined || query.limit !== undefined;
  return {
    search,
    sortBy,
    sortDir,
    page,
    limit,
    paginate,
    skip: paginate ? skip : undefined,
    take: paginate ? limit : undefined,
  };
};

// Build the standard list response: flat `data` plus a `pagination` block only
// when pagination was requested.
const listResponse = (
  res: Response,
  items: unknown[],
  total: number,
  ctx: { paginate: boolean; page: number; limit: number }
) => {
  const body: Record<string, unknown> = { success: true, data: items };
  if (ctx.paginate) body.pagination = buildPagination(total, ctx.page, ctx.limit);
  return res.status(200).json(body);
};

// SQL body schemas: FK ids are numeric ints (not 24-hex) on the SQL path.
const socialLinkCreateSqlSchema = z.object({
  typeId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(255),
  icon: z.string().max(500).optional(),
  link: z.string().min(1).max(500).url("Invalid link URL"),
  order: z.number().int().default(0),
  status: z.boolean().optional(),
});
const socialLinkUpdateSqlSchema = socialLinkCreateSqlSchema.partial();
const liveBannerCreateSqlSchema = z.object({
  image: z.string().min(1).max(500),
  liveCourseId: z.coerce.number().int().positive(),
  orderBy: z.number().int().default(0),
});
const liveBannerUpdateSqlSchema = liveBannerCreateSqlSchema.partial();

// ─── FAQ ──
export const listFaqs = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const q = parseAdminList(req.query as Record<string, any>);
    const typeId = typeof req.query.typeId === "string" ? req.query.typeId : undefined;
    // Unknown type → 422 rather than a dropped filter that returns every category
    // mixed together (which reads as "the filter is broken"). Case-insensitive, so
    // the label casing "Referral" resolves.
    const resolvedType = resolveFaqTypeFilter(typeId);
    if (!resolvedType.ok) {
      logger.warn("listFaqs invalid type filter", { traceId, typeId });
      return res.status(422).json({ success: false, message: FAQ_TYPE_FILTER_MESSAGE, messages: { typeId: FAQ_TYPE_FILTER_MESSAGE } });
    }
    const { items, total } = await listFaqsPagedService({ typeId: resolvedType.type, search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take });
    return listResponse(res, items, total, q);
  } catch (e: any) {
    logger.error("listFaqs failed", { traceId, error: getErrorMessage(e) });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (!parseFaqId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const doc = await getFaqById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getFaq failed", { traceId, id, error: getErrorMessage(e) });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const data = faqCreateSchemaMysql.parse(req.body);
    const doc = await createFaqService(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (!parseFaqId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const data = faqUpdateSchemaMysql.parse(req.body);
    const doc = await updateFaqService(id, data);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (!parseFaqId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const ok = await deleteFaqService(id);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── FAQ Type ──
export const listFaqTypes = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  try {
    const data = await listFaqTypesService();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listFaqTypes failed", { traceId, error: getErrorMessage(e) });
    return res.status(500).json({ success: false, message: e.message });
  }
};
// FAQ categories are FIXED (general, referral) on the legacy MySQL schema —
// `ws_faq.type` is an enum, there is no `ws_faq_types` table. So types are a
// synthetic read-only list: get resolves against FAQ_TYPES; create/update/delete
// are not representable and return a fixed-category message.
const FAQ_CATEGORY_FIXED_MESSAGE =
  "FAQ categories are fixed (general, referral) on the legacy MySQL schema and cannot be modified.";

export const getFaqType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getFaqType invoked", { traceId, path: req.originalUrl, id });

  try {
    if (!(FAQ_TYPES as readonly string[]).includes(id)) {
      logger.warn("getFaqType not found", { traceId, id });
      return res.status(404).json({ success: false, message: "Not found." });
    }
    const type = id as (typeof FAQ_TYPES)[number];
    return res.status(200).json({
      success: true,
      data: { _id: type, title: FAQ_TYPE_LABELS[type] ?? type },
    });
  } catch (e: any) {
    logger.error("getFaqType failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createFaqType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createFaqType invoked", { traceId, path: req.originalUrl });

  try {
    faqTypeCreateSchema.parse(req.body);
    return res.status(400).json({ success: false, message: FAQ_CATEGORY_FIXED_MESSAGE });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("createFaqType failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateFaqType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("updateFaqType invoked", { traceId, path: req.originalUrl, id });

  try {
    faqTypeUpdateSchema.parse(req.body);
    return res.status(400).json({ success: false, message: FAQ_CATEGORY_FIXED_MESSAGE });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("updateFaqType failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteFaqType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("deleteFaqType invoked", { traceId, path: req.originalUrl, id });

  try {
    return res.status(400).json({ success: false, message: FAQ_CATEGORY_FIXED_MESSAGE });
  } catch (e: any) {
    logger.error("deleteFaqType failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Popup ──
// Delegated to popup service (MySQL/Prisma when listed in
// MIGRATION_MYSQL_MODULES, Mongo otherwise). API JSON shape preserved.
// `promoExpireAt` is coerced to a Date inside the service/transformer.
const popupIdInvalid = (id: string) => !parsePopupId(id);

export const listPopups = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const q = parseAdminList(req.query as Record<string, any>);
    const { items, total } = await listPopupsPagedService({ search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take });
    return listResponse(res, items, total, q);
  } catch (e: any) {
    logger.error("listPopups failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getPopup = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (popupIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await getPopupByIdService(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getPopup failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const createPopup = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const data = popupCreateSchema.parse(req.body);
    const doc = await createPopupService(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("createPopup failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const updatePopup = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (popupIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = popupUpdateSchema.parse(req.body);
    const doc = await updatePopupService(id, data);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("updatePopup failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const deletePopup = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (popupIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await deletePopupService(id);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error("deletePopup failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Banner ──
// Data access delegated to banner-slider service (MySQL/Prisma when listed in
// MIGRATION_MYSQL_MODULES, Mongo otherwise). API JSON shape preserved.
const bannerIdInvalid = (id: string) => !parseBannerId(id);

export const listBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listBanners invoked", { traceId, path: req.originalUrl });

  try {
    const q = parseAdminList(req.query as Record<string, any>);
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    const { items, total } = await listBannersPagedService({ key, search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take });
    logger.info("listBanners success", { traceId, count: items.length, total });
    return listResponse(res, items, total, q);
  } catch (e: any) {
    logger.error("listBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getBanner = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getBanner invoked", { traceId, path: req.originalUrl, id });

  try {
    if (bannerIdInvalid(id)) { logger.warn("getBanner invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const doc = await getBannerByIdService(id);
    if (!doc) { logger.warn("getBanner not found", { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("getBanner success", { traceId, id });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getBanner failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const createBanner = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createBanner invoked", { traceId, path: req.originalUrl });

  try {
    const data = bannerCreateSchema.parse(req.body);
    const doc = await createBannerService(data);
    logger.info("createBanner success", { traceId, id: doc._id });
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) { logger.warn("createBanner validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("createBanner failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const updateBanner = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("updateBanner invoked", { traceId, path: req.originalUrl, id });

  try {
    if (bannerIdInvalid(id)) { logger.warn("updateBanner invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const data = bannerUpdateSchema.parse(req.body);
    const doc = await updateBannerService(id, data);
    if (!doc) { logger.warn("updateBanner not found", { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("updateBanner success", { traceId, id });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) { logger.warn("updateBanner validation failed", { traceId, id, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("updateBanner failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const deleteBanner = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("deleteBanner invoked", { traceId, path: req.originalUrl, id });

  try {
    if (bannerIdInvalid(id)) { logger.warn("deleteBanner invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const ok = await deleteBannerService(id);
    if (!ok) { logger.warn("deleteBanner not found", { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("deleteBanner success", { traceId, id });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error("deleteBanner failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const reorderBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("reorderBanners invoked", { traceId, path: req.originalUrl });

  try {
    const { orders } = reorderSchema.parse(req.body);
    const count = await reorderBannersService(orders);
    if (!count) { logger.warn("reorderBanners no valid ids", { traceId }); return res.status(400).json({ success: false, message: "No valid ids." }); }
    logger.info("reorderBanners success", { traceId, count });
    return res.status(200).json({ success: true, message: "Banner order updated." });
  } catch (e: any) {
    if (e.issues) { logger.warn("reorderBanners validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("reorderBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Live Banner ──
export const listLiveBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveBanners invoked", { traceId, path: req.originalUrl });

  try {
    const q = parseAdminList(req.query as Record<string, any>);

    const { items, total } = await cmsx.listLiveBannersPaged({ search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take });
    logger.info("listLiveBanners success", { traceId, count: items.length, total });
    return listResponse(res, items, total, q);
  } catch (e: any) {
    logger.error("listLiveBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getLiveBanner = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getLiveBanner invoked", { traceId, path: req.originalUrl, id });

  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const d = await cmsx.getLiveBanner(nid);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) {
    logger.error("getLiveBanner failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const createLiveBanner = async (req: Request, res: Response) => {
  try {
    const data = liveBannerCreateSqlSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await cmsx.createLiveBanner(data) });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const updateLiveBanner = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = liveBannerUpdateSqlSchema.parse(req.body);
    const d = await cmsx.updateLiveBanner(nid, data);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const deleteLiveBanner = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await cmsx.deleteLiveBanner(nid);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};

export const reorderLiveBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("reorderLiveBanners invoked", { traceId, path: req.originalUrl });

  try {
    const { orders } = reorderSchema.parse(req.body);
    const count = await cmsx.reorderLiveBanners(orders);
    if (!count) return res.status(400).json({ success: false, message: "No valid ids." });
    logger.info("reorderLiveBanners success", { traceId, count });
    return res.status(200).json({ success: true, message: "Live banner order updated." });
  } catch (e: any) {
    if (e.issues) { logger.warn("reorderLiveBanners validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("reorderLiveBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Testimonial ──
// Delegated to testimonial service (MySQL/Prisma when listed in
// MIGRATION_MYSQL_MODULES, Mongo otherwise). API JSON shape preserved.
const testimonialIdInvalid = (id: string) => !parseTestimonialId(id);

export const listTestimonials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const q = parseAdminList(req.query as Record<string, any>);
    const { items, total } = await listTestimonialsPagedService({ search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take });
    return listResponse(res, items, total, q);
  } catch (e: any) {
    logger.error("listTestimonials failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getTestimonial = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (testimonialIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await getTestimonialByIdService(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getTestimonial failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const createTestimonial = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const data = testimonialCreateSchema.parse(req.body);
    const doc = await createTestimonialService(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("createTestimonial failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const updateTestimonial = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (testimonialIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = testimonialUpdateSchema.parse(req.body);
    const doc = await updateTestimonialService(id, data);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("updateTestimonial failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const deleteTestimonial = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (testimonialIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await deleteTestimonialService(id);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error("deleteTestimonial failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Social Link Type ── (dual-path: cms-extra SQL flag)
export const listSocialLinkTypes = async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, data: await cmsx.listSocialLinkTypes() });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};
export const getSocialLinkType = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const d = await cmsx.getSocialLinkType(nid);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};
export const createSocialLinkType = async (req: Request, res: Response) => {
  try {
    const data = socialLinkTypeCreateSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await cmsx.createSocialLinkType(data) });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const updateSocialLinkType = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = socialLinkTypeUpdateSchema.parse(req.body);
    const d = await cmsx.updateSocialLinkType(nid, data);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const deleteSocialLinkType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const r = await cmsx.deleteSocialLinkType(nid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error("deleteSocialLinkType failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Social Link ── (dual-path)
export const listSocialLinks = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  try {
    return res.status(200).json({ success: true, data: await cmsx.listSocialLinks() });
  } catch (e: any) {
    logger.error("listSocialLinks failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getSocialLink = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const d = await cmsx.getSocialLink(nid);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};
export const createSocialLink = async (req: Request, res: Response) => {
  try {
    const data = socialLinkCreateSqlSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await cmsx.createSocialLink(data) });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const updateSocialLink = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = socialLinkUpdateSqlSchema.parse(req.body);
    const d = await cmsx.updateSocialLink(nid, data);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const deleteSocialLink = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await cmsx.deleteSocialLink(nid);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};

// ─── Current Affairs ── (dual-path)
export const listCurrentAffairs = async (req: Request, res: Response) => {
  try {
    const q = parseAdminList(req.query as Record<string, any>);

    const { items, total } = await cmsx.listCurrentAffairsPaged({ search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take });
    return listResponse(res, items, total, q);
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};
export const getCurrentAffair = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const d = await cmsx.getCurrentAffair(nid);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};
export const createCurrentAffair = async (req: Request, res: Response) => {
  try {
    const data = currentAffairCreateSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await cmsx.createCurrentAffair(data) });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const updateCurrentAffair = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = currentAffairUpdateSchema.parse(req.body);
    const d = await cmsx.updateCurrentAffair(nid, data);
    if (!d) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: d });
  } catch (e: any) { if (e.issues) return res.status(400).json({ success: false, errors: e.issues }); return res.status(500).json({ success: false, message: e.message }); }
};
export const deleteCurrentAffair = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const nid = cmsx.parseCmsId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await cmsx.deleteCurrentAffair(nid);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
};

// ─── Terms ──
// Delegated to terms service (MySQL/Prisma when listed in
// MIGRATION_MYSQL_MODULES, Mongo otherwise). API JSON shape preserved.
const termsIdInvalid = (id: string) => !parseTermsId(id);

export const listTerms = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  try {
    const data = await listTermsService();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listTerms failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getTerms = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (termsIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await getTermsByIdService(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getTerms failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const createTerms = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    // MySQL `module` is a fixed enum; use the stricter schema.
    const data = termsCreateSchemaMysql.parse(req.body);
    const doc = await createTermsService(data);
    // 409, not 400: the payload is valid — the module is simply already taken. A
    // second row would silently shadow the first on the client read (findFirst).
    if (isTermsConflict(doc)) {
      logger.warn("createTerms duplicate module", { traceId, module: doc.module, existingId: doc.existingId });
      return res.status(409).json({ success: false, message: `Terms for "${doc.module}" already exist. Edit the existing entry instead.`, data: { existingId: String(doc.existingId) } });
    }
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("createTerms failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const updateTerms = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (termsIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = termsUpdateSchemaMysql.parse(req.body);
    const doc = await updateTermsService(id, data);
    if (isTermsConflict(doc)) {
      logger.warn("updateTerms duplicate module", { traceId, id, module: doc.module, existingId: doc.existingId });
      return res.status(409).json({ success: false, message: `Terms for "${doc.module}" already exist. Edit the existing entry instead.`, data: { existingId: String(doc.existingId) } });
    }
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    logger.error("updateTerms failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const deleteTerms = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (termsIdInvalid(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await deleteTermsService(id);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error("deleteTerms failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Version (singleton) ──
export const getVersion = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getVersion invoked", { traceId, path: _req.originalUrl });

  try {
    const doc = await getVersionSettings();
    logger.info("getVersion success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getVersion failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const upsertVersion = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("upsertVersion invoked", { traceId, path: req.originalUrl });

  try {
    const data = versionUpsertSchema.parse(req.body);
    const doc = await upsertVersionSettings(data);
    logger.info("upsertVersion success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) { logger.warn("upsertVersion validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("upsertVersion failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── AppUpdate (singleton) ──
export const getAppUpdate = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getAppUpdate invoked", { traceId, path: _req.originalUrl });

  try {
    const doc = await getAppUpdateSettings();
    logger.info("getAppUpdate success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getAppUpdate failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const upsertAppUpdate = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("upsertAppUpdate invoked", { traceId, path: req.originalUrl });

  try {
    const data = appUpdateUpsertSchema.parse(req.body);
    const doc = await upsertAppUpdateSettings(data);
    logger.info("upsertAppUpdate success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) { logger.warn("upsertAppUpdate validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("upsertAppUpdate failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
