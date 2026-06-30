import { Request, Response } from "express";
import {
  createPromocodeSchema,
  updatePromocodeSchema,
  togglePromocodeStatusSchema,
  bulkPromocodeIdsSchema,
  bulkPromocodeStatusSchema,
} from "./promocode.validation";
import * as pcSql from "../../modules/promo-code/promo-code.service";

export const getPromocodes = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      type,
      fromDate,
      toDate,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const r = await pcSql.listPromocodes({
      search: search?.trim() || null,
      status: status === "true" ? true : status === "false" ? false : null,
      type: type === "public" || type === "private" ? type : null,
      fromDate: fromDate ? new Date(fromDate) : null,
      toDate: toDate ? new Date(toDate) : null,
      skip,
      limitNum,
      pageNum,
    });
    return res.status(200).json({ success: true, ...r });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPromocodeById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const nid = pcSql.parsePcId(id);
    if (nid == null)
      return res.status(400).json({ success: false, message: "Invalid promocode id." });
    const r = await pcSql.getPromocodeById(nid);
    if ((r as any).notFound)
      return res.status(404).json({ success: false, message: "Promocode not found." });
    // C5: real plan-link `plans[]` for the edit screen.
    const plans = await pcSql.loadPlanLinksSql(nid);
    return res
      .status(200)
      .json({ success: true, data: { ...(r as any).data, plans } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPromocode = async (req: Request, res: Response) => {
  try {
    const data = createPromocodeSchema.parse(req.body);
    const code = data.promocode.toUpperCase();

    // appliesTo is normalized to [{type, ids:string[]}] by the schema (single
    // object OR array). Convert to numeric groups (multi-type aware).
    const groups = data.appliesTo.map((g) => ({ type: g.type as pcSql.AppliesToType, ids: g.ids.map((x) => Number(x)) }));
    if (groups.some((g) => g.ids.some((n) => !Number.isInteger(n) || n <= 0)))
      return res.status(400).json({ success: false, message: "Invalid appliesTo ids." });

    const promoterId = data.promoterId != null ? pcSql.parsePcId(data.promoterId) : null;
    try {
      const r = await pcSql.createPromocode({
        promocode: code,
        title: data.title,
        description: data.description,
        promo_start_at: new Date(data.promo_start_at),
        promo_expire_at: new Date(data.promo_expire_at),
        type: data.type,
        status: data.status ?? true,
        discountType: data.discountType,
        discountValue: data.discountValue,
        promoterId,
        appliesTo: groups,
      });
      if ((r as any).conflict)
        return res.status(409).json({ success: false, message: "Promocode already exists." });
      // Plan-link % sync across ALL referenced types (multi-type aware).
      if (data.plans.length) {
        const nid = pcSql.parsePcId(String((r as any).data._id));
        if (nid != null) {
          const validPlans = await pcSql.resolveValidPlansMultiSql(groups);
          await pcSql.syncPlanLinksSql(nid, data.plans, validPlans);
        }
      }
      return res.status(201).json({ success: true, data: (r as any).data });
    } catch (e: any) {
      if (e.__badRequest)
        return res.status(400).json({ success: false, message: e.message });
      throw e;
    }
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.__badRequest)
      return res.status(400).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePromocode = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const data = updatePromocodeSchema.parse(req.body);

    const nid = pcSql.parsePcId(id);
    if (nid == null)
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    let appliesTo: pcSql.AppliesGroup[] | undefined;
    if (data.appliesTo) {
      appliesTo = data.appliesTo.map((g) => ({ type: g.type as pcSql.AppliesToType, ids: g.ids.map((x) => Number(x)) }));
      if (appliesTo.some((g) => g.ids.some((n) => !Number.isInteger(n) || n <= 0)))
        return res.status(400).json({ success: false, message: "Invalid appliesTo ids." });
    }
    const promoterId =
      data.promoterId === undefined
        ? undefined
        : data.promoterId == null
        ? null
        : pcSql.parsePcId(data.promoterId);

    try {
      const r = await pcSql.updatePromocode(nid, {
        promocode: data.promocode,
        title: data.title,
        description: data.description,
        promo_start_at: data.promo_start_at ? new Date(data.promo_start_at) : undefined,
        promo_expire_at: data.promo_expire_at ? new Date(data.promo_expire_at) : undefined,
        type: data.type,
        status: data.status,
        discountType: data.discountType,
        discountValue: data.discountValue,
        promoterId,
        appliesTo,
      });
      if ((r as any).notFound)
        return res.status(404).json({ success: false, message: "Promocode not found." });
      if ((r as any).conflict)
        return res.status(409).json({ success: false, message: "Promocode already exists." });
      // Plan-link % replace-semantics across ALL referenced types. Effective
      // groups = the just-saved appliesTo (if part of this update), else the
      // existing row's groups.
      if (data.plans !== undefined) {
        const effGroups = appliesTo ?? (await pcSql.getAppliesToGroupsById(nid));
        const validPlans = await pcSql.resolveValidPlansMultiSql(effGroups);
        await pcSql.syncPlanLinksSql(nid, data.plans, validPlans);
      } else if (appliesTo) {
        // appliesTo changed but plans omitted: drop now-orphaned links across
        // the full (multi-type) covered set.
        const validPlans = await pcSql.resolveValidPlansMultiSql(appliesTo);
        await pcSql.prunePlanLinksSql(nid, [...validPlans.keys()]);
      }
      return res.status(200).json({ success: true, data: (r as any).data });
    } catch (e: any) {
      if (e.__badRequest)
        return res.status(400).json({ success: false, message: e.message });
      throw e;
    }
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.__badRequest)
      return res.status(400).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePromocode = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const nid = pcSql.parsePcId(id);
    if (nid == null)
      return res.status(400).json({ success: false, message: "Invalid promocode id." });
    // Drop plan links first (FK-safe), then the rule.
    await pcSql.deletePlanLinksSql([nid]);
    const r = await pcSql.deletePromocode(nid);
    if ((r as any).notFound)
      return res.status(404).json({ success: false, message: "Promocode not found." });
    return res.status(200).json({ success: true, message: "Promocode deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const togglePromocodeStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = togglePromocodeStatusSchema.safeParse(req.body);

    const nid = pcSql.parsePcId(id);
    if (nid == null)
      return res.status(400).json({ success: false, message: "Invalid promocode id." });
    const r = await pcSql.toggleStatus(nid, parsed.success ? parsed.data.status : null);
    if ((r as any).notFound)
      return res.status(404).json({ success: false, message: "Promocode not found." });
    return res.status(200).json({ success: true, data: (r as any).data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkStatus = async (req: Request, res: Response) => {
  try {
    const { ids, status } = bulkPromocodeStatusSchema.parse(req.body);

    const nids = ids.map((x) => pcSql.parsePcId(x)).filter((n): n is number => n != null);
    if (!nids.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    const r = await pcSql.bulkStatus(nids, status);
    return res.status(200).json({ success: true, matched: r.matched, modified: r.modified });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDelete = async (req: Request, res: Response) => {
  try {
    const { ids } = bulkPromocodeIdsSchema.parse(req.body);

    const nids = ids.map((x) => pcSql.parsePcId(x)).filter((n): n is number => n != null);
    if (!nids.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    await pcSql.deletePlanLinksSql(nids);
    await pcSql.bulkDelete(nids);
    return res.status(200).json({ success: true, message: "Promocodes deleted." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPromocodePlans = async (req: Request, res: Response) => {
  try {
    const { type, examTypeId, search } = req.query as Record<string, string>;

    const data = await pcSql.getPromocodePlansSql({ type, examTypeId, search });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
