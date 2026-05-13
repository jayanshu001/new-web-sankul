import { Request, Response } from "express";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { getRazorpay, razorpayResponseFor } from "./razorpay";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createOrderSchema = z.object({
  // LiveCoursePlan._id — single source of truth for price/duration.
  planId: objectId,
});

// POST /api/v1/client/payment/create-order/live-course
// Mirrors createCourseOrderPayment but writes to LiveCourseSubscription so the
// existing course flow stays isolated.
export const createLiveCourseOrderPayment = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const rp = getRazorpay();
    if (!rp) {
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    const { planId } = createOrderSchema.parse(req.body);

    const plan = await LiveCoursePlan.findOne({ _id: planId, status: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    if (!plan.price || plan.price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const course = await LiveCourse.findOne({ _id: plan.liveCourseId, status: true });
    if (!course) {
      return res.status(404).json({ success: false, message: "Live course not found or inactive." });
    }

    const now = new Date();
    const existingPaid = await LiveCourseSubscription.findOne({
      customerId,
      liveCourseId: plan.liveCourseId,
      status: true,
      paymentStatus: "verified",
      $or: [{ endAt: null }, { endAt: { $gte: now } }],
    });
    if (existingPaid) {
      return res.status(409).json({
        success: false,
        message: "You already have an active subscription to this live course.",
      });
    }

    const subscription = await LiveCourseSubscription.create({
      customerId,
      liveCourseId: plan.liveCourseId,
      planId: plan._id,
      paidAmount: plan.price,
      paymentStatus: "pending",
      status: true,
    });

    const receiptId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await rp.orders.create({
      amount: Math.round(plan.price * 100),
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "live-course",
        subscriptionId: String(subscription._id),
        liveCourseId: String(plan.liveCourseId),
        planId: String(plan._id),
        customerId: String(customerId),
      },
    });

    subscription.razorpayOrderId = rzpOrder.id;
    await subscription.save();

    return res.status(201).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: plan.price,
        liveCourse: { _id: course._id, name: course.name },
        plan: { _id: plan._id, duration: plan.duration, price: plan.price },
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};
