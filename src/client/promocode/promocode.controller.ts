import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { Customer } from "../../models/customer/Customer.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { applyPromocodeSchema } from "./promocode.validation";
import { promoCovers, computePromoDiscount } from "./applies-to";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v?: string | null) => !!v && mongoose.Types.ObjectId.isValid(v);

// Resolve what a given id ACTUALLY is, independent of which request field it
// arrived in. The FE sends a different entity each time (package / course /
// ebook) and historically had to file it under the exactly-matching field —
// a `package` id sent as `course` produced a misleading "not applicable"
// error. We instead detect the type from the id itself so the field name no
// longer has to be correct. Checks the cheapest/most-common first.
//
// Returns the detected entity type + the id, or null if the id matches no
// package/course/ebook. (liveCourse and test-series promos use their own
// planId-based endpoints — /payment/apply-promo/* — and are out of scope here.)
async function detectEntity(
  id: string
): Promise<{ type: "package" | "course" | "ebook"; id: string } | null> {
  if (!isObjectId(id)) return null;
  const oid = new mongoose.Types.ObjectId(id);
  const [pkg, course, ebook] = await Promise.all([
    Package.exists({ _id: oid }),
    Course.exists({ _id: oid }),
    Ebook.exists({ _id: oid }),
  ]);
  if (pkg) return { type: "package", id };
  if (course) return { type: "course", id };
  if (ebook) return { type: "ebook", id };
  return null;
}

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
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const filter = {
      status: true,
      type: "public",
      promo_start_at: { $lt: now },
      promo_expire_at: { $gt: now },
    };

    const [data, total] = await Promise.all([
      PromoCode.find(filter)
        .select("_id promocode title description discountType discountValue promo_start_at promo_expire_at")
        .sort({ promo_expire_at: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PromoCode.countDocuments(filter),
    ]);

    logger.info("listPromocodes success", { traceId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
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
    if (!isObjectId(rawId)) {
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

    const entity = await detectEntity(rawId!);
    if (!entity) {
      logger.warn("applyPromocode id matches no entity", { traceId, customerId: userId, promocode, rawId });
      return res.status(404).json({
        success: false,
        message: "No package, course, or ebook found for the selected item.",
      });
    }

    const planFilter: any = { status: true };
    // cartType drives the appliesTo coverage check. Ebook is now part of the
    // appliesTo model, but its plans live in a SEPARATE collection (EbookPrice),
    // so it's loaded on its own path below rather than via planFilter.
    let cartType: "package" | "course" | "ebook" | null = null;
    let cartId: string | null = null;
    if (entity.type === "package") {
      planFilter.packageId = entity.id;
      cartType = "package";
      cartId = entity.id;
    } else if (entity.type === "course") {
      planFilter.courseId = entity.id;
      cartType = "course";
      cartId = entity.id;
    } else {
      // ebook — plans come from EbookPrice (loaded below), and the promocode
      // path now covers ebooks via appliesTo.
      cartType = "ebook";
      cartId = entity.id;
    }

    const pricingPlans: PlanDoc[] = (
      entity.type === "ebook"
        ? await EbookPrice.find({ ebookId: entity.id, status: true }).sort({ duration: 1 }).lean()
        : await PackageCourseEbookPrice.find(planFilter).sort({ duration: 1 }).lean()
    ).map((p) => ({ ...p }));

    if (!pricingPlans.length) { logger.warn("applyPromocode no pricing plans", { traceId, customerId: userId, cartType, cartId }); return res.status(404).json({ success: false, message: "This promocode is not applicable for this item." }); }

    const code = promocode.toUpperCase();
    const now = new Date();

    const [promo, referralCustomer, referralProgram] = await Promise.all([
      PromoCode.findOne({
        promocode: code,
        status: true,
        promo_start_at: { $lt: now },
        promo_expire_at: { $gt: now },
      }).lean(),
      Customer.findOne({
        referralCode: code,
        isAccountDeleted: false,
        status: true,
      }).lean(),
      ReferralProgram.findOne({ name: "student", status: true }).lean(),
    ]);

    if (!promo && !referralCustomer) {
      logger.warn("applyPromocode invalid code", { traceId, customerId: userId, promocode: code });
      return res.status(400).json({ success: false, message: "Invalid promocode!" });
    }

    // Referral code path
    if (referralCustomer) {
      if (userId && String(userId) === String(referralCustomer._id)) {
        logger.warn("applyPromocode self-referral", { traceId, customerId: userId, promocode: code });
        return res.status(400).json({
          success: false,
          message:
            "Oops! It looks like you're trying to use your own referral code. Please refer a friend or family member instead.",
        });
      }
      if (!referralProgram) {
        logger.warn("applyPromocode referral program inactive", { traceId, customerId: userId });
        return res
          .status(404)
          .json({ success: false, message: "Referral program currently deactivated!" });
      }

      pricingPlans.forEach((plan) => {
        plan.offerAvailable = false;
        plan.orginalPrice = plan.price;
        if (plan.price > referralProgram.minimumPrice) {
          plan.offerAvailable = true;
          plan.offerPercentage = referralProgram.referralDiscount;
          plan.price = plan.price - Math.round((plan.price * referralProgram.referralDiscount) / 100);
        }
      });

      logger.info("applyPromocode referral success", { traceId, customerId: userId, promocode: code });
      return res.status(200).json({
        success: true,
        data: {
          promocode: referralCustomer.referralCode,
          key: entity.type,
          plans: splitByMaterial(pricingPlans),
        },
      });
    }

    // Promocode path — uses the new `appliesTo` model: promocode applies to a
    // top-level entity (package / course / liveCourse). If the cart entity is
    // not covered, reject. The single `discountType`/`discountValue` on the
    // promocode is used as the discount for every plan of that entity.
    if (!cartType || !cartId) {
      logger.warn("applyPromocode no cart entity", { traceId, customerId: userId, promocode: code });
      return res
        .status(404)
        .json({ success: false, message: "This promocode is not valid for this course!" });
    }

    if (!promoCovers(promo!, { type: cartType, id: cartId })) {
      logger.warn("applyPromocode not covered", { traceId, customerId: userId, promocode: code, cartType, cartId });
      return res
        .status(404)
        .json({ success: false, message: "This promocode is not valid for this course!" });
    }

    const promoDiscountType = promo!.discountType;
    const promoDiscountValue = Number(promo!.discountValue ?? 0);
    if (!(promoDiscountValue > 0)) {
      logger.warn("applyPromocode zero discount", { traceId, customerId: userId, promocode: code });
      return res
        .status(400)
        .json({ success: false, message: "This promocode has no discount configured." });
    }

    pricingPlans.forEach((plan) => {
      plan.orginalPrice = plan.price;
      plan.offerAvailable = true;
      plan.discountType = promoDiscountType;
      plan.discountValue = promoDiscountValue;
      const discount = computePromoDiscount(promo!, plan.price);
      if (promoDiscountType === "percentage") plan.offerPercentage = promoDiscountValue;
      plan.price = Math.max(0, plan.price - discount);
    });

    const first = pricingPlans[0];
    const id = first.packageId || first.courseId || first.ebookId;
    const key = first.packageId ? "package" : first.courseId ? "course" : "ebook";

    logger.info("applyPromocode success", { traceId, customerId: userId, promocode: code, cartType, cartId });
    return res.status(200).json({
      success: true,
      data: {
        ...promo,
        id,
        key,
        plans: splitByMaterial(pricingPlans),
      },
    });
  } catch (error: any) {
    if (error.issues) { logger.warn("applyPromocode validation failed", { traceId, customerId: userId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("applyPromocode failed", { traceId, customerId: userId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
