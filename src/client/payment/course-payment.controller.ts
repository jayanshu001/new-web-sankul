import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { getRazorpay, razorpayResponseFor } from "./razorpay";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createCourseOrderSchema = z.object({
  // PackageCourseEbookPrice._id — the specific plan/duration the user picked.
  // We deliberately key on this rather than (courseId, duration) because the
  // PackageCourseEbookPrice row is the single source of truth for the price.
  packageId: objectId,
});

// POST /api/v1/client/payment/create-order/course
// Creates a PackageCourseSubscription in paymentStatus="pending" and a Razorpay
// order. After /verify flips paymentStatus → "verified", access is granted.
export const createCourseOrderPayment = async (req: Request, res: Response) => {
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

    const { packageId } = createCourseOrderSchema.parse(req.body);

    const plan = await PackageCourseEbookPrice.findOne({ _id: packageId, status: true });
    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    }
    if (!plan.courseId) {
      return res.status(400).json({
        success: false,
        message: "This plan is not a course plan. Use the matching endpoint for ebook plans.",
      });
    }
    if (!plan.price || plan.price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const course = await Course.findOne({ _id: plan.courseId, status: true });
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found or inactive." });
    }

    // Block double-buy: if the customer already has a verified active sub for
    // this exact plan, refuse — they shouldn't pay twice.
    const existingPaid = await PackageCourseSubscription.findOne({
      customerId,
      courseId: plan.courseId,
      packageId: plan._id,
      status: true,
      paymentStatus: "verified",
    });
    if (existingPaid) {
      return res.status(409).json({
        success: false,
        message: "You already have an active subscription to this plan.",
      });
    }

    // Create local row first (pending). Verify endpoint flips it to verified.
    const subscription = await PackageCourseSubscription.create({
      customerId,
      courseId: plan.courseId,
      packageId: plan._id,
      paidAmount: plan.price,
      paymentStatus: "pending",
      status: true,
    });

    const receiptId = `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await rp.orders.create({
      amount: Math.round(plan.price * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "course",
        subscriptionId: String(subscription._id),
        courseId: String(plan.courseId),
        packageId: String(plan._id),
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
        course: {
          _id: course._id,
          name: course.name,
        },
        plan: {
          _id: plan._id,
          duration: plan.duration,
          price: plan.price,
        },
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};
