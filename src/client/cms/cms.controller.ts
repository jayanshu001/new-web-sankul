import { Request, Response } from "express";
import {
  listFaqsClientPaged as listFaqsService,
  listFaqTypesClientPaged as listFaqTypesService,
  resolveFaqTypeFilter,
  FAQ_TYPE_FILTER_MESSAGE,
} from "../../modules/faq/faq.service";
import { listBannersClientPaged as listBannersService } from "../../modules/banner-slider/banner-slider.service";
import { listTestimonialsClientPaged as listTestimonialsService } from "../../modules/testimonial/testimonial.service";
import { getClientTerms, resolveTermsModuleFilter, TERMS_MODULE_FILTER_MESSAGE } from "../../modules/terms/terms.service";
import { getActivePopup as getActivePopupService } from "../../modules/popup/popup.service";
import { checkClientUpgrade } from "../../modules/cms/upgrade-check.service";
import { getVersionSettings } from "../../modules/version/version.service";
import {
  listClientSocialLinksPaged as listClientSocialLinksSql,
  listSocialLinkTypesPaged as listSocialLinkTypesSql,
  listClientCurrentAffairsPaged as listClientCurrentAffairsSql,
  listLiveBannersClientPaged as listLiveBannersSql,
} from "../../modules/cms/cms-extra.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { pickList, omit } from "../../utils/pick";

// Client-only field projections (mobile app reads a subset of each DTO). Applied
// at the controller edge so the shared module transformers — and the admin
// responses that reuse them — keep their full shape. See docs/api-optimization.
const FAQ_CLIENT_FIELDS = ["_id", "typeId", "question", "answer"] as const;
const SOCIAL_LINK_CLIENT_FIELDS = ["_id", "title", "link", "typeId"] as const;
const LIVE_BANNER_CLIENT_FIELDS = ["_id", "image", "liveCourseId", "orderBy"] as const;
const TESTIMONIAL_CLIENT_FIELDS = ["_id", "name", "description", "rating"] as const;

// GET /api/v1/client/faqs[?typeId=…]
export const listFaqs = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFaqs invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { typeId, type } = req.query as Record<string, string>;
    const filterKey = typeId ?? type;
    // An unknown type is a 422, NOT a dropped filter. Silently ignoring it returns
    // general + referral mixed together, so a typo in the app reads as "the
    // referral sheet gained extra content" instead of failing. Same rule
    // /client/subscriptions/access applies to a bad `kinds`. Valid values resolve
    // case-insensitively, so `?type=Referral` (the display label) works.
    const resolvedType = resolveFaqTypeFilter(filterKey);
    if (!resolvedType.ok) {
      logger.warn("listFaqs invalid type filter", { traceId, type: filterKey });
      return res.status(422).json({ success: false, message: FAQ_TYPE_FILTER_MESSAGE, messages: { type: FAQ_TYPE_FILTER_MESSAGE } });
    }
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listFaqsService({
      typeId: resolvedType.type,
      search,
      skip,
      take: limit,
    });
    logger.info("listFaqs success", { traceId, count: data.length });
    return res.status(200).json({
      success: true,
      data: pickList(data, FAQ_CLIENT_FIELDS),
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listFaqs failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/faq-types
export const listFaqTypes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFaqTypes invoked", { traceId, path: req.originalUrl });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listFaqTypesService({ search, skip, take: limit });
    logger.info("listFaqTypes success", { traceId, count: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listFaqTypes failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/popup — active popup (most recent non-expired)
export const getActivePopup = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getActivePopup invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await getActivePopupService();
    logger.info("getActivePopup success", { traceId, hasPopup: !!data });
    // PromoPopupModal reads display columns only — drop status/timestamps
    // (see docs/api-optimization/GET_client_popup.md).
    return res.status(200).json({
      success: true,
      data: data ? omit(data as Record<string, any>, ["status", "createdAt", "updatedAt"]) : null,
    });
  } catch (e: any) {
    logger.error("getActivePopup failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/banners
export const listBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listBanners invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { key } = req.query as Record<string, string>;
    const { page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listBannersService({
      key: key || undefined,
      skip,
      take: limit,
    });
    logger.info("listBanners success", { traceId, key, count: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/cms/live-banners
export const listLiveBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveBanners invoked", { traceId, path: req.originalUrl });

  try {
    const { page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listLiveBannersSql({ skip, take: limit });
    logger.info("listLiveBanners success", { traceId, count: data.length });
    return res.status(200).json({
      success: true,
      data: pickList(data, LIVE_BANNER_CLIENT_FIELDS),
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listLiveBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/testimonials
export const listTestimonials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listTestimonials invoked", { traceId, path: req.originalUrl });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listTestimonialsService({ search, skip, take: limit });
    logger.info("listTestimonials success", { traceId, count: data.length });
    return res.status(200).json({
      success: true,
      data: pickList(data, TESTIMONIAL_CLIENT_FIELDS),
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listTestimonials failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/social-links — active social links, ordered
export const listSocialLinks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listSocialLinks invoked", { traceId, path: req.originalUrl });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listClientSocialLinksSql({ search, skip, take: limit });
    logger.info("listSocialLinks success", { traceId, count: data.length });
    return res.status(200).json({
      success: true,
      data: pickList(data, SOCIAL_LINK_CLIENT_FIELDS),
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listSocialLinks failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/social-link-types
export const listSocialLinkTypes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listSocialLinkTypes invoked", { traceId, path: req.originalUrl });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listSocialLinkTypesSql({ search, skip, take: limit });
    logger.info("listSocialLinkTypes success", { traceId, count: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listSocialLinkTypes failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/current-affairs[?search=&page=&limit=] — active current
// affairs for the home screen, newest first. Returns only the fields the client
// renders (image, title, youtubeLink). Supports `?search=` (title) + pagination.
export const listCurrentAffairs = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCurrentAffairs invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { items: data, total } = await listClientCurrentAffairsSql({ search, skip, take: limit });
    logger.info("listCurrentAffairs success", { traceId, count: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: buildPagination(total, page, limit),
    });
  } catch (e: any) {
    logger.error("listCurrentAffairs failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/terms[?module=xxx]
export const getTerms = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getTerms invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { module: moduleName } = req.query as Record<string, string>;
    // Unknown module → 422, not a silent `data: null` the app renders as "no terms".
    // Resolves case-insensitively, so `?module=Referral code` works.
    const resolvedModule = resolveTermsModuleFilter(moduleName);
    if (!resolvedModule.ok) {
      logger.warn("getTerms invalid module filter", { traceId, module: moduleName });
      return res.status(422).json({ success: false, message: TERMS_MODULE_FILTER_MESSAGE, messages: { module: TERMS_MODULE_FILTER_MESSAGE } });
    }
    const data = await getClientTerms(resolvedModule.module);
    logger.info("getTerms success", { traceId, moduleName });
    return res.status(200).json({ success: true, data: data ?? null });
  } catch (e: any) {
    logger.error("getTerms failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/version — current app version config
export const getVersion = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getVersion invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await getVersionSettings();
    logger.info("getVersion success", { traceId });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getVersion failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/upgrade[?clientVersion=123] — whether an update is available
export const checkUpgrade = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("checkUpgrade invoked", { traceId, path: req.originalUrl, clientVersion: req.query.clientVersion });

  try {
    const clientVersion = Number((req.query.clientVersion as string) ?? "") || 0;
    const data = await checkClientUpgrade(clientVersion);

    logger.info("checkUpgrade success", {
      traceId,
      clientVersion: data.clientVersion,
      latest: data.latestVersion,
      isUpdateAvailable: data.isUpdateAvailable,
      isForceUpdate: data.isForceUpdate,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("checkUpgrade failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
