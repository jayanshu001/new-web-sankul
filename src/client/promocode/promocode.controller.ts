import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Customer } from "../../models/customer/Customer.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { applyPromocodeSchema } from "./promocode.validation";

const isObjectId = (v?: string | null) => !!v && mongoose.Types.ObjectId.isValid(v);

type PlanDoc = any;

const splitByMaterial = (plans: PlanDoc[]) => {
  const withMaterial: PlanDoc[] = [];
  const withoutMaterial: PlanDoc[] = [];
  plans.forEach((p) => (p.withMaterial ? withMaterial.push(p) : withoutMaterial.push(p)));
  return { withMaterial, withoutMaterial };
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
    if (isObjectId(packageId)) planFilter.packageId = packageId;
    else if (isObjectId(courseId)) planFilter.courseId = courseId;
    else if (isObjectId(ebookId)) planFilter.ebookId = ebookId;
    else
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

    // Promocode path
    const promotedPlans = await PromotedPackageCourseEbook.find({ promocodeId: promo!._id })
      .populate({ path: "planId", model: "PackageCourseEbookPrice" })
      .lean();

    const validPromoted = promotedPlans.filter((pp: any) => {
      if (!pp.planId) return false;
      if (packageId) return String(pp.planId.packageId) === String(packageId) && pp.planId.status;
      if (courseId) return String(pp.planId.courseId) === String(courseId) && pp.planId.status;
      if (ebookId) return String(pp.planId.ebookId) === String(ebookId) && pp.planId.status;
      return false;
    });

    if (!validPromoted.length) {
      return res
        .status(404)
        .json({ success: false, message: "This promocode is not valid for this course!" });
    }

    pricingPlans.forEach((plan) => {
      plan.offerAvailable = false;
      plan.orginalPrice = plan.price;
      const match = validPromoted.find(
        (pp: any) => String(pp.planId._id) === String(plan._id)
      );
      if (match) {
        plan.offerAvailable = true;
        plan.offerPercentage = match.customerPercentage;
        plan.price = plan.price - Math.round((plan.price * match.customerPercentage) / 100);
      }
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
