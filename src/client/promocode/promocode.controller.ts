import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Customer } from "../../models/customer/Customer.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { applyPromocodeSchema } from "./promocode.validation";
import { promoCovers, computePromoDiscount } from "./applies-to";

const isObjectId = (v?: string | null) => !!v && mongoose.Types.ObjectId.isValid(v);

type PlanDoc = any;

const splitByMaterial = (plans: PlanDoc[]) => {
  const withMaterial: PlanDoc[] = [];
  const withoutMaterial: PlanDoc[] = [];
  plans.forEach((p) => (p.withMaterial ? withMaterial.push(p) : withoutMaterial.push(p)));
  return { withMaterial, withoutMaterial };
};

export const listPromocodes = async (req: Request, res: Response) => {
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

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const applyPromocode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;
    const parsed = applyPromocodeSchema.parse(req.body);
    const { promocode } = parsed;
    const packageId = parsed.package || null;
    const courseId = parsed.course || null;
    const ebookId = parsed.ebook || null;

    const planFilter: any = { status: true };
    let cartType: "package" | "course" | null = null;
    let cartId: string | null = null;
    if (isObjectId(packageId)) {
      planFilter.packageId = packageId;
      cartType = "package";
      cartId = packageId!;
    } else if (isObjectId(courseId)) {
      planFilter.courseId = courseId;
      cartType = "course";
      cartId = courseId!;
    } else if (isObjectId(ebookId)) {
      planFilter.ebookId = ebookId;
      // Ebooks are not part of the new appliesTo model — promocode path will
      // reject, only the referral-code path can discount ebook plans.
    } else
      return res.status(400).json({ success: false, message: "Invalid course selection!" });

    const pricingPlans: PlanDoc[] = (
      await PackageCourseEbookPrice.find(planFilter).sort({ duration: 1 }).lean()
    ).map((p) => ({ ...p }));

    if (!pricingPlans.length)
      return res.status(404).json({ success: false, message: "No pricing plans available." });

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
      return res.status(400).json({ success: false, message: "Invalid promocode!" });
    }

    // Referral code path
    if (referralCustomer) {
      if (userId && String(userId) === String(referralCustomer._id)) {
        return res.status(400).json({
          success: false,
          message:
            "Oops! It looks like you're trying to use your own referral code. Please refer a friend or family member instead.",
        });
      }
      if (!referralProgram) {
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

      return res.status(200).json({
        success: true,
        data: {
          promocode: referralCustomer.referralCode,
          key: packageId ? "package" : courseId ? "course" : "ebook",
          plans: splitByMaterial(pricingPlans),
        },
      });
    }

    // Promocode path — uses the new `appliesTo` model: promocode applies to a
    // top-level entity (package / course / liveCourse). If the cart entity is
    // not covered, reject. The single `discountType`/`discountValue` on the
    // promocode is used as the discount for every plan of that entity.
    if (!cartType || !cartId) {
      return res
        .status(404)
        .json({ success: false, message: "This promocode is not valid for this course!" });
    }

    if (!promoCovers(promo!, { type: cartType, id: cartId })) {
      return res
        .status(404)
        .json({ success: false, message: "This promocode is not valid for this course!" });
    }

    const promoDiscountType = promo!.discountType;
    const promoDiscountValue = Number(promo!.discountValue ?? 0);
    if (!(promoDiscountValue > 0)) {
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
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};
