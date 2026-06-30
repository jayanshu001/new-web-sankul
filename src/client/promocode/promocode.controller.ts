import { Request, Response } from "express";
import mongoose from "mongoose";
import { applyPromocodeSchema } from "./promocode.validation";
import { computePromoDiscount } from "./applies-to";
import * as pcSql from "../../modules/promo-code/promo-code.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v?: string | null) => !!v && mongoose.Types.ObjectId.isValid(v);

type PlanDoc = any;

const splitByMaterial = (plans: PlanDoc[]) => {
  const withMaterial: PlanDoc[] = [];
  const withoutMaterial: PlanDoc[] = [];
  plans.forEach((p) => (p.withMaterial ? withMaterial.push(p) : withoutMaterial.push(p)));
  return { withMaterial, withoutMaterial };
};

export const listPromocodes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listPromocodes invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { page = "1", limit = "20", type: rawType, id: rawId } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    // Optional entity filter — show only the public codes whose `appliesTo`
    // covers a specific entity. Requires BOTH `type` and `id` (or neither): a
    // bare int id is ambiguous across modules, so the module `type` is needed
    // to know which entity the id belongs to. type accepts kebab aliases
    // (test-series / live-course / e-book).
    const hasType = typeof rawType === "string" && rawType.trim() !== "";
    const hasId = typeof rawId === "string" && rawId.trim() !== "";
    if (hasType !== hasId) {
      return res.status(422).json({ success: false, message: "Provide both `type` and `id` to filter, or neither." });
    }
    let appliesToType: ReturnType<typeof pcSql.normalizeAppliesToType> = null;
    if (hasType) {
      appliesToType = pcSql.normalizeAppliesToType(rawType);
      if (!appliesToType) {
        return res.status(422).json({ success: false, message: "Invalid type. Use one of: package, course, testSeries, ebook, liveCourse." });
      }
    }
    const filterById = appliesToType !== null && hasId;

    // Public, active-window promocode list from MySQL.
    let appliesTo: { type: NonNullable<typeof appliesToType>; id: number } | undefined;
    if (filterById) {
      const nid = pcSql.parsePcId(rawId.trim());
      if (nid == null) {
        return res.status(422).json({ success: false, message: "Invalid id." });
      }
      appliesTo = { type: appliesToType!, id: nid };
    }
    const result = await pcSql.listPublicPromocodes({ skip, limitNum, pageNum, appliesTo });
    logger.info("listPromocodes success (mysql)", { traceId, total: result.pagination.total, type: appliesToType, filtered: filterById });
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error: any) {
    logger.error("listPromocodes failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const applyPromocode = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = (req as any).user?.id || (req as any).user?._id;
  logger.info("applyPromocode invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    const parsed = applyPromocodeSchema.parse(req.body);
    const { promocode } = parsed;

    // Preferred unified `targetId`, then the legacy per-type fields. We don't
    // trust the field name OR the supplied `targetType` — the id's true entity
    // type is detected below, so a mislabelled target can't break the apply.
    const rawId =
      parsed.targetId || parsed.package || parsed.course || parsed.ebook || null;
    // The entity id is a positive integer (e.g. "3"); re-validated via parsePcId.
    const idLooksValid =
      isObjectId(rawId) || pcSql.parsePcId(rawId ?? "") != null;
    if (!idLooksValid) {
      logger.warn("applyPromocode invalid selection", { traceId, customerId: userId, promocode });
      return res.status(400).json({ success: false, message: "Invalid course selection!" });
    }

    // liveCourse / testSeries discounts are previewed via their own dedicated,
    // plan-based endpoints. If the FE explicitly targets one of those, point it
    // there with a clear message instead of a confusing "not applicable" (this
    // endpoint only knows the package/course/ebook appliesTo model).
    if (parsed.targetType === "liveCourse" || parsed.targetType === "testSeries") {
      const endpoint =
        parsed.targetType === "liveCourse"
          ? "/payment/apply-promo/live-course"
          : "/payment/apply-promo/test-series";
      logger.warn("applyPromocode wrong endpoint for target", { traceId, customerId: userId, promocode, targetType: parsed.targetType });
      return res.status(400).json({
        success: false,
        message: `Use ${endpoint} to apply a promo code to a ${parsed.targetType}.`,
      });
    }

    // Resolve the entity, load SQL pricing plans, and apply SQL coverage +
    // discount. The referral-code path is handled by dedicated endpoints.
    const nid = pcSql.parsePcId(rawId!);
    if (nid == null) {
      return res.status(400).json({ success: false, message: "Invalid course selection!" });
    }
    const sqlEntity = await pcSql.detectEntitySql(nid);
    if (!sqlEntity) {
      logger.warn("applyPromocode id matches no entity (sql)", { traceId, customerId: userId, promocode, rawId });
      return res.status(404).json({
        success: false,
        message: "No package, course, or ebook found for the selected item.",
      });
    }

    const pricingPlans: PlanDoc[] = (await pcSql.loadPricingPlansSql(sqlEntity)).map((p) => ({ ...p }));
    if (!pricingPlans.length) {
      logger.warn("applyPromocode no pricing plans (sql)", { traceId, customerId: userId, sqlEntity });
      return res.status(404).json({ success: false, message: "This promocode is not applicable for this item." });
    }

    const code = promocode.toUpperCase();
    const promo = await pcSql.findActiveByCode(code);
    if (!promo) {
      logger.warn("applyPromocode invalid code (sql)", { traceId, customerId: userId, promocode: code });
      return res.status(400).json({ success: false, message: "Invalid promocode!" });
    }

    if (!pcSql.promoCovers(promo, { type: sqlEntity.type, id: sqlEntity.id })) {
      logger.warn("applyPromocode not covered (sql)", { traceId, customerId: userId, promocode: code, sqlEntity });
      return res.status(404).json({ success: false, message: "This promocode is not valid for this course!" });
    }

    const promoDiscountType = promo.discountType as "flat" | "percentage";
    const promoDiscountValue = Number(promo.discountValue ?? 0);

    // Per-plan link rows are the authoritative discount source (TASK 2
    // checkout): each plan's discount = its own customerPercentage, and a plan
    // with NO link row gets no discount. Legacy codes with no link rows at all
    // fall back to the global discountValue so old promocodes keep working.
    const planDiscounts = await pcSql.loadPlanDiscountsSql(promo.id);
    const hasLinks = planDiscounts.size > 0;

    if (!hasLinks && !(promoDiscountValue > 0)) {
      logger.warn("applyPromocode zero discount (sql)", { traceId, customerId: userId, promocode: code });
      return res.status(400).json({ success: false, message: "This promocode has no discount configured." });
    }

    let matchedAny = false;
    pricingPlans.forEach((plan) => {
      plan.orginalPrice = plan.price;
      // Resolve THIS plan's discount: per-plan % when link rows exist, else
      // the legacy global discount for old codes.
      let dType: "flat" | "percentage";
      let dValue: number;
      if (hasLinks) {
        const pct = planDiscounts.get(Number((plan as any).id));
        if (pct == null) {
          // entity is covered, but this specific plan has no link row → no discount
          plan.offerAvailable = false;
          plan.discountType = promoDiscountType;
          plan.discountValue = 0;
          plan.offerPercentage = 0;
          return;
        }
        dType = "percentage";
        dValue = pct;
      } else {
        dType = promoDiscountType;
        dValue = promoDiscountValue;
      }
      matchedAny = true;
      plan.offerAvailable = dValue > 0;
      plan.discountType = dType;
      plan.discountValue = dValue;
      const discount = computePromoDiscount({ discountType: dType, discountValue: dValue }, plan.price);
      if (dType === "percentage") plan.offerPercentage = dValue;
      plan.price = Math.max(0, plan.price - discount);
    });

    if (hasLinks && !matchedAny) {
      // covered entity but none of its plans have a link row for this code
      logger.warn("applyPromocode no plan links for item (sql)", { traceId, customerId: userId, promocode: code, sqlEntity });
      return res.status(404).json({ success: false, message: "This promocode is not applicable for this item." });
    }

    logger.info("applyPromocode success (sql)", { traceId, customerId: userId, promocode: code, sqlEntity });
    return res.status(200).json({
      success: true,
      data: {
        _id: String(promo.id),
        promocode: promo.promocode,
        discountType: promoDiscountType,
        discountValue: promoDiscountValue,
        id: sqlEntity.id,
        key: sqlEntity.type,
        plans: splitByMaterial(pricingPlans),
      },
    });
  } catch (error: any) {
    if (error.issues) { logger.warn("applyPromocode validation failed", { traceId, customerId: userId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("applyPromocode failed", { traceId, customerId: userId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
