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
} from "../../modules/catalog-package/catalog-package.detail.sql";
import cache from "../../libs/cache";
import { listActiveSubscriptionsByCustomer } from "../../modules/commerce-subscription/commerce-subscription.service";
import { prisma as prismaPkg } from "../../config/prisma";
import { listChatMessagesMysql } from "../../modules/package-chat/package-chat.service";
import { hasActivePackageSubscription } from "../../modules/commerce-subscription/commerce-subscription.service";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const getPackageDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getPackageDetail invoked", { traceId, path: req.originalUrl, userId: req.user?.id, packageId: id });

  try {
    // ── MySQL (ws_package + category links + plans/promo/sub) ──────────────────
    const pid = parsePackageId(id);
    if (!pid) { logger.warn("getPackageDetail invalid id (mysql)", { traceId, packageId: id }); return res.status(400).json({ success: false, message: "Invalid package id." }); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const detailSql = await buildPackageDetailSql(pid, Number.isInteger(cid) ? cid : null, resolveBase(req));
    if (!detailSql) { logger.warn("getPackageDetail not found (mysql)", { traceId, packageId: id }); return res.status(404).json({ success: false, message: "Package not found." }); }
    // Drop nested catalog trees (RN loads tabs via GET /client/catalog/…) + empty
    // promo list; slim the package DTO (packageType/goal/isPopular/subtitle/
    // examCountdown* unused). scope + plans kept. See docs/api-optimization Phase 3.
    const { videos, materials, tests, availablePromoCode, package: pkg, ...restDetail } = detailSql as any;
    const slimDetail = {
      ...restDetail,
      package: omit(pkg, ["packageType", "goal", "isPopular", "subtitle", "examCountdownCategoryIds", "examCountdownIds"]),
    };
    logger.info("getPackageDetail success (mysql)", { traceId, packageId: id });
    if (req.user?.id) {
      queueCRMLead({ params: { userId: req.user.id, packageId: pid }, leadType: CRM_LEAD_TYPE.VIEW_PACKAGE }, { traceId, userId: req.user.id, packageId: pid });
    }
    return res.status(200).json({ success: true, data: slimDetail });
  } catch (error: any) {
    logger.error("getPackageDetail failed", { traceId, packageId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/packages
// Flat paginated listing of active packages, with optional filters.
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

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 500);
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
    // Drop FE-unused FK/meta fields from each card (see docs/api-optimization).
    const slimData = omitList(dataSql, ["goalLabelId", "active", "pcMaterialId", "examId", "packageTypeId", "goalId", "order"]);
    logger.info("listPackages success (mysql)", { traceId, total: totalSql, returned: dataSql.length });
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
    if (!tid) { logger.warn("listPackagesByType invalid id (mysql)", { traceId, typeId }); return res.status(400).json({ success: false, message: "Invalid type id." }); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const listOpts = { search, skip, take: limit };
    const { total, data: enrichedSql } = await listPackagesCached(
      `by-type:${tid}:${cache.hashFilter(listOpts)}`,
      () => listPackagesByTypeSql(tid, listOpts),
      Number.isInteger(cid) ? cid : null,
      resolveBase(req)
    );
    logger.info("listPackagesByType success (mysql)", { traceId, typeId, count: enrichedSql.length, total });
    return res.status(200).json({ success: true, data: enrichedSql, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listPackagesByType failed", { traceId, typeId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/packages/goal?labelIds=id1,id2,id3
// Returns one entry per requested goal-label, with that label's packages
// nested inside the `label` object. Driven by labels from /client/goals/my-goals.
export const listPackagesByGoal = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listPackagesByGoal invoked", { traceId, path: req.originalUrl, userId: req.user?.id, labelIds: req.query.labelIds });

  try {
    const parseIntCsv = (v: unknown): number[] =>
      String(v ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number);
    // labelIds → label-based groups (goals WITH labels). Label ids are per-goal
    // (they restart at 1 per goal), so each entry SHOULD be goal-scoped as
    // `goalId:labelId` (e.g. "19:1"). A bare `labelId` is still accepted for
    // backward compatibility (unscoped → may match across goals — see below).
    // goalIds → goal-level groups of individual packages (label-less goals).
    // At least one of labelIds / goalIds is required.
    const parseLabelRefs = (v: unknown): { goalId: number | null; labelId: number }[] =>
      String(v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((tok) => {
          const [a, b] = tok.split(":").map((p) => p.trim());
          if (b !== undefined) {
            // composite "goalId:labelId"
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
    // `search` filters each group's packages by name; `skip`/`take` page each
    // group by the same window. Top-level `pagination.total` is the sum of the
    // per-group match counts (the response stays grouped).
    const { search, page, limit, skip } = parseListQuery(req.query);
    const goals = await prismaPkg.customerTargetGoal.findMany({ select: { id: true, name: true, labels: true } });
    const goalById = new Map(goals.map((g) => [g.id, g]));

    // ── label-based groups ────────────────────────────────────────────────────
    // Resolve a label's display name within a specific goal.
    const labelName = (goalId: number, labelId: number): string | null => {
      const labels = Array.isArray(goalById.get(goalId)?.labels) ? (goalById.get(goalId)!.labels as any[]) : [];
      const hit = labels.find((l) => Number(l?.id) === labelId);
      return hit ? String(hit?.name ?? "") : null;
    };
    // Legacy fallback: bare labelId with no goal context — find the first goal
    // that owns a label with this id (ambiguous if multiple goals share the id).
    const firstGoalForLabel = (labelId: number): number | null => {
      for (const g of goals) {
        const labels = Array.isArray(g.labels) ? (g.labels as any[]) : [];
        if (labels.some((l) => Number(l?.id) === labelId)) return g.id;
      }
      return null;
    };
    const labelGroups = await Promise.all(
      labelRefs.map(async (ref) => {
        // Prefer goal-scoped lookup (correct); fall back to unscoped for legacy bare ids.
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

    // ── goal-level (individual) groups ─────────────────────────────────────────
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
    logger.info("listPackagesByGoal success (mysql)", { traceId, labelCount: labelGroups.length, goalCount: goalGroups.length, total });
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
    // ws_package_type has no `order`/`active` cols; the service synthesizes
    // `order:0` + `active:true` so the response JSON stays shape-compatible.
    const { data: types, total } = await listPackageTypesMysql({ search, skip, take: limit });
    const slimTypes = omitList(types, ["order", "active", "createdAt", "updatedAt"]);
    logger.info("listPackageTypes success", { traceId, count: types.length, total, source: "mysql" });
    return res.status(200).json({ success: true, data: slimTypes, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listPackageTypes failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listMyPackages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyPackages invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("listMyPackages unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const now = new Date();

    // ── MySQL branch ──────────────────────────────────────────────────────────
    const cid = Number(customerId);
    if (!Number.isInteger(cid)) { logger.warn("listMyPackages invalid customer (mysql)", { traceId, customerId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const { search, page, limit, skip } = parseListQuery(req.query);
    const activeSubs = (await listActiveSubscriptionsByCustomer(cid)).filter((s) => s.targetPackageId);
    const pkgIds = [...new Set(activeSubs.map((s) => Number(s.targetPackageId)).filter(Number.isInteger))];
    const pkgs = pkgIds.length ? await prismaPkg.package.findMany({ where: { id: { in: pkgIds } } }) : [];
    const enriched = await enrichPackagesSql(pkgs, cid, resolveBase(req));
    const byId = new Map(enriched.map((p) => [p._id, p]));
    const dataAll = activeSubs.map((s) => ({
      ...s,
      packageId: byId.get(String(s.targetPackageId)) ?? null,
      daysLeft: computeDaysLeft(s.endAt ?? null, now),
    }));
    // Non-Prisma source (subscriptions): filter by the enriched package name,
    // then slice the resolved array. `total` reflects the post-search set.
    const filtered = search
      ? dataAll.filter((d) => matchesAllTokens(search, [String((d.packageId as any)?.name ?? "")]))
      : dataAll;
    const total = filtered.length;
    const dataSql = filtered.slice(skip, skip + limit);
    logger.info("listMyPackages success (mysql)", { traceId, customerId, count: dataSql.length, total });
    return res.status(200).json({ success: true, data: dataSql, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listMyPackages failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const getChatMessages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const packageId = req.params.packageId as string;
  logger.info("getChatMessages invoked", { traceId, path: req.originalUrl, customerId, packageId });

  try {
    if (!customerId) { logger.warn("getChatMessages unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ── MySQL package-chat read ──────────────────────────────────────────────
    // A MySQL package id is an int. The subscription gate uses the MySQL
    // commerce-subscription module (int ids).
    const packageIdInt = Number(packageId);
    const customerIdInt = Number(customerId); // C3 seam
    if (!Number.isInteger(packageIdInt) || packageIdInt <= 0) {
      logger.warn("getChatMessages invalid id (mysql)", { traceId, customerId, packageId });
      return res.status(400).json({ success: false, message: "Invalid package id." });
    }
    const activeMysql = await hasActivePackageSubscription(customerIdInt, packageIdInt);
    if (!activeMysql) {
      logger.warn("getChatMessages no active subscription (mysql)", { traceId, customerId, packageId });
      return res.status(403).json({
        success: false,
        message: "You must have an active subscription to view package chat.",
      });
    }
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 500);
    const { data, total } = await listChatMessagesMysql(packageIdInt, pageNum, limitNum);
    logger.info("getChatMessages success (mysql)", { traceId, customerId, packageId, total });
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
