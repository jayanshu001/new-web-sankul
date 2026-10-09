// Client packages: HTTP handlers for catalog, goal groups, my packages and chat.
import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";
import { matchesAllTokens } from "../../utils/searchFilter";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { omit, omitList } from "../../utils/pick";
import {
  parsePackageId,
  listPackageTypes as listPackageTypesMysql,
} from "../../modules/catalog-package/catalog-package.service";
import {
  buildPackageDetailSql,
  enrichPackagesSql,
  listPackagesCached,
  listPackagesPaginatedSql,
  listPackagesByTypeSql,
  listPackagesByGoalLabelSql,
  listPackagesByGoalLabelScopedSql,
  listPackagesByGoalIndividualSql,
  findPackagesByIds,
  listGoalsWithLabels,
} from "../../modules/catalog-package/catalog-package.detail.sql";
import cache from "../../libs/cache";
import { listActiveSubscriptionsByCustomer } from "../../modules/commerce-subscription/commerce-subscription.service";
import { listChatMessagesMysql } from "../../modules/package-chat/package-chat.service";
import { hasActivePackageSubscription } from "../../modules/commerce-subscription/commerce-subscription.service";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

export const getPackageDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getPackageDetail invoked", { traceId, path: req.originalUrl, userId: req.user?.id, packageId: id });

  try {
    const pid = parsePackageId(id);
    if (!pid) { logger.warn("getPackageDetail invalid id", { traceId, packageId: id }); return res.status(400).json({ success: false, message: "Invalid package id." }); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const detailSql = await buildPackageDetailSql(pid, Number.isInteger(cid) ? cid : null, resolveBase(req));
    if (!detailSql) { logger.warn("getPackageDetail not found", { traceId, packageId: id }); return res.status(404).json({ success: false, message: "Package not found." }); }
    // Nested catalog trees are dropped (the app loads tabs via GET /client/catalog/…),
    // along with the empty promo list and unused package fields.
    const { videos, materials, tests, availablePromoCode, package: pkg, ...restDetail } = detailSql as any;
    const slimDetail = {
      ...restDetail,
      package: omit(pkg, ["packageType", "goal", "isPopular", "subtitle", "examCountdownCategoryIds", "examCountdownIds"]),
    };
    logger.info("getPackageDetail success", { traceId, packageId: id });
    if (req.user?.id) {
      queueCRMLead({ params: { userId: req.user.id, packageId: pid }, leadType: CRM_LEAD_TYPE.VIEW_PACKAGE }, { traceId, userId: req.user.id, packageId: pid });
    }
    return res.status(200).json({ success: true, data: slimDetail });
  } catch (error: any) {
    logger.error("getPackageDetail failed", { traceId, packageId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Paginated package catalog (shared cache, live per-user isPurchased overlay).
export const listPackages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listPackages invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const {
      search,
      packageTypeId,
      goalId,
      type,
      isPopular,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const { page: pageNum, limit: limitNum } = parseListQuery({ page, limit }, { defaultLimit: 20, maxLimit: 500 });
    const skip = (pageNum - 1) * limitNum;

    const cid = req.user?.id ? Number(req.user.id) : null;
    const filter = {
      search: search?.trim() || undefined,
      isPopular: isPopular === "true" ? true : isPopular === "false" ? false : undefined,
      isPaid: type === "paid" ? true : type === "free" ? false : undefined,
      packageTypeId: packageTypeId && /^\d+$/.test(packageTypeId) ? Number(packageTypeId) : undefined,
      goalId: goalId && /^\d+$/.test(goalId) ? Number(goalId) : undefined,
      skip,
      take: limitNum,
    };
    const { total: totalSql, data: dataSql } = await listPackagesCached(
      `list:${cache.hashFilter(filter)}`,
      () => listPackagesPaginatedSql(filter),
      Number.isInteger(cid) ? cid : null,
      resolveBase(req)
    );
    const slimData = omitList(dataSql, ["goalLabelId", "active", "pcMaterialId", "examId", "packageTypeId", "goalId", "order"]);
    logger.info("listPackages success", { traceId, total: totalSql, returned: dataSql.length });
    return res.status(200).json({
      success: true,
      data: slimData,
      pagination: { total: totalSql, page: pageNum, limit: limitNum, totalPages: Math.ceil(totalSql / limitNum) },
    });
  } catch (error: any) {
    logger.error("listPackages failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackagesByType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const typeId = req.params.typeId as string;
  logger.info("listPackagesByType invoked", { traceId, path: req.originalUrl, userId: req.user?.id, typeId });

  try {
    const tid = parsePackageId(typeId);
    if (!tid) { logger.warn("listPackagesByType invalid id", { traceId, typeId }); return res.status(400).json({ success: false, message: "Invalid type id." }); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const listOpts = { search, skip, take: limit };
    const { total, data: enrichedSql } = await listPackagesCached(
      `by-type:${tid}:${cache.hashFilter(listOpts)}`,
      () => listPackagesByTypeSql(tid, listOpts),
      Number.isInteger(cid) ? cid : null,
      resolveBase(req)
    );
    logger.info("listPackagesByType success", { traceId, typeId, count: enrichedSql.length, total });
    return res.status(200).json({ success: true, data: enrichedSql, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listPackagesByType failed", { traceId, typeId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// One entry per requested goal-label, with its packages nested inside `label`.
export const listPackagesByGoal = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listPackagesByGoal invoked", { traceId, path: req.originalUrl, userId: req.user?.id, labelIds: req.query.labelIds });

  try {
    const parseIntCsv = (v: unknown): number[] =>
      String(v ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number);
    // labelIds → label-based groups. Label ids restart at 1 per goal, so entries should be
    // `goalId:labelId` (e.g. "19:1"); a bare labelId is still accepted but may match across goals.
    // goalIds → goal-level groups of individual (label-less) packages. One of the two is required.
    const parseLabelRefs = (v: unknown): { goalId: number | null; labelId: number }[] =>
      String(v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((tok) => {
          const [a, b] = tok.split(":").map((p) => p.trim());
          if (b !== undefined) {
            if (/^\d+$/.test(a) && /^\d+$/.test(b)) return { goalId: Number(a), labelId: Number(b) };
            return null;
          }
          if (/^\d+$/.test(a)) return { goalId: null, labelId: Number(a) }; // legacy bare labelId
          return null;
        })
        .filter((x): x is { goalId: number | null; labelId: number } => x !== null);

    const labelRefs = parseLabelRefs(req.query.labelIds);
    const goalIntIds = parseIntCsv(req.query.goalIds);

    if (!labelRefs.length && !goalIntIds.length) {
      logger.warn("listPackagesByGoal missing labelIds/goalIds", { traceId });
      return res.status(400).json({
        success: false,
        message: "labelIds (goalId:labelId) or goalIds query param is required (comma-separated).",
      });
    }

    const cid = req.user?.id ? Number(req.user.id) : null;
    const base = resolveBase(req);
    // `search` filters each group's packages by name; `skip`/`take` page each group.
    // `pagination.total` is the sum of per-group match counts.
    const { search, page, limit, skip } = parseListQuery(req.query);
    const goals = await listGoalsWithLabels();
    const goalById = new Map(goals.map((g) => [g.id, g]));

    const labelName = (goalId: number, labelId: number): string | null => {
      const labels = Array.isArray(goalById.get(goalId)?.labels) ? (goalById.get(goalId)!.labels as any[]) : [];
      const hit = labels.find((l) => Number(l?.id) === labelId);
      return hit ? String(hit?.name ?? "") : null;
    };
    // Bare labelId with no goal: first goal owning that label id (ambiguous by design).
    const firstGoalForLabel = (labelId: number): number | null => {
      for (const g of goals) {
        const labels = Array.isArray(g.labels) ? (g.labels as any[]) : [];
        if (labels.some((l) => Number(l?.id) === labelId)) return g.id;
      }
      return null;
    };
    const labelGroups = await Promise.all(
      labelRefs.map(async (ref) => {
        const goalId = ref.goalId ?? firstGoalForLabel(ref.labelId);
        const { rows, total } = goalId != null
          ? await listPackagesByGoalLabelScopedSql(goalId, ref.labelId, { search, skip, take: limit })
          : await listPackagesByGoalLabelSql(ref.labelId, { search, skip, take: limit });
        const enriched = omitList(await enrichPackagesSql(rows, Number.isInteger(cid) ? cid : null, base), ["goalLabelId", "active", "pcMaterialId", "examId", "packageTypeId", "goalId", "order"]);
        return {
          entry: {
            label: {
              _id: String(ref.labelId),
              name: goalId != null ? labelName(goalId, ref.labelId) : null,
              goalId: goalId != null ? String(goalId) : null,
              goalTitle: goalId != null ? (goalById.get(goalId)?.name ?? null) : null,
              packages: enriched,
            },
          },
          total,
        };
      })
    );

    const goalGroups = await Promise.all(
      goalIntIds.map(async (gid) => {
        const { rows, total } = await listPackagesByGoalIndividualSql(gid, { search, skip, take: limit });
        const enriched = omitList(await enrichPackagesSql(rows, Number.isInteger(cid) ? cid : null, base), ["goalLabelId", "active", "pcMaterialId", "examId", "packageTypeId", "goalId", "order"]);
        return { entry: { goal: { _id: String(gid), title: goalById.get(gid)?.name ?? null, packages: enriched } }, total };
      })
    );

    const combined = [...labelGroups, ...goalGroups];
    const resultSql = combined.map((c) => c.entry);
    const total = combined.reduce((acc, c) => acc + c.total, 0);
    logger.info("listPackagesByGoal success", { traceId, labelCount: labelGroups.length, goalCount: goalGroups.length, total });
    return res.status(200).json({ success: true, data: resultSql, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listPackagesByGoal failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackageTypes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listPackageTypes invoked", { traceId, path: req.originalUrl });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    // ws_package_type has no `order`/`active` columns; the service synthesizes
    // `order:0` + `active:true` to keep the response shape.
    const { data: types, total } = await listPackageTypesMysql({ search, skip, take: limit });
    const slimTypes = omitList(types, ["order", "active", "createdAt", "updatedAt"]);
    logger.info("listPackageTypes success", { traceId, count: types.length, total, source: "mysql" });
    return res.status(200).json({ success: true, data: slimTypes, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listPackageTypes failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Caller's active package subscriptions, each with the enriched package and daysLeft.
export const listMyPackages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyPackages invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("listMyPackages unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const now = new Date();

    const cid = Number(customerId);
    if (!Number.isInteger(cid)) { logger.warn("listMyPackages invalid customer", { traceId, customerId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const { search, page, limit, skip } = parseListQuery(req.query);
    const activeSubs = (await listActiveSubscriptionsByCustomer(cid)).filter((s) => s.targetPackageId);
    const pkgIds = [...new Set(activeSubs.map((s) => Number(s.targetPackageId)).filter(Number.isInteger))];
    const pkgs = await findPackagesByIds(pkgIds);
    const enriched = await enrichPackagesSql(pkgs, cid, resolveBase(req));
    const byId = new Map(enriched.map((p) => [p._id, p]));
    const dataAll = activeSubs.map((s) => ({
      ...s,
      packageId: byId.get(String(s.targetPackageId)) ?? null,
      daysLeft: computeDaysLeft(s.endAt ?? null, now),
    }));
    // Search runs in memory on the enriched package name; `total` is the post-search count.
    const filtered = search
      ? dataAll.filter((d) => matchesAllTokens(search, [String((d.packageId as any)?.name ?? "")]))
      : dataAll;
    const total = filtered.length;
    const dataSql = filtered.slice(skip, skip + limit);
    logger.info("listMyPackages success", { traceId, customerId, count: dataSql.length, total });
    return res.status(200).json({ success: true, data: dataSql, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listMyPackages failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Package chat history; requires an active subscription to that package.
export const getChatMessages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const packageId = req.params.packageId as string;
  logger.info("getChatMessages invoked", { traceId, path: req.originalUrl, customerId, packageId });

  try {
    if (!customerId) { logger.warn("getChatMessages unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const packageIdInt = Number(packageId);
    const customerIdInt = Number(customerId);
    if (!Number.isInteger(packageIdInt) || packageIdInt <= 0) {
      logger.warn("getChatMessages invalid id", { traceId, customerId, packageId });
      return res.status(400).json({ success: false, message: "Invalid package id." });
    }
    const activeMysql = await hasActivePackageSubscription(customerIdInt, packageIdInt);
    if (!activeMysql) {
      logger.warn("getChatMessages no active subscription", { traceId, customerId, packageId });
      return res.status(403).json({
        success: false,
        message: "You must have an active subscription to view package chat.",
      });
    }
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const { page: pageNum, limit: limitNum } = parseListQuery({ page, limit }, { defaultLimit: 20, maxLimit: 500 });
    const { data, total } = await listChatMessagesMysql(packageIdInt, pageNum, limitNum);
    logger.info("getChatMessages success", { traceId, customerId, packageId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("getChatMessages failed", { traceId, customerId, packageId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
