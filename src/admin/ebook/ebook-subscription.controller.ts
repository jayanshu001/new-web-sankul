import { Request, Response } from "express";
import { createEbookSubscriptionSqlSchema, updateEbookSubscriptionSchema } from "./ebook.validation";
import * as adminEbook from "../../modules/admin-ebook/admin-ebook.service";

export const getEbookSubscriptions = async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      ebookId,
      status,
      search,
      sortBy,
      sortOrder,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    if (customerId && !adminEbook.parseEbookId(customerId)) {
      return res.status(400).json({ success: false, message: "Invalid customerId" });
    }
    if (ebookId && !adminEbook.parseEbookId(ebookId)) {
      return res.status(400).json({ success: false, message: "Invalid ebookId" });
    }
    const { items, total } = await adminEbook.listSubscriptions({
      customerId: customerId ? adminEbook.parseEbookId(customerId)! : undefined,
      ebookId: ebookId ? adminEbook.parseEbookId(ebookId)! : undefined,
      status: status === "true" ? true : status === "false" ? false : undefined,
      search,
      sortBy,
      sortOrder,
      page: pageNum,
      limit: limitNum,
    });
    return res.status(200).json({
      success: true,
      items,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEbookSubscriptionById = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    const data = await adminEbook.getSubscriptionById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Subscription not found" });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createEbookSubscription = async (req: Request, res: Response) => {
  try {
    const d = createEbookSubscriptionSqlSchema.parse(req.body);
    const result = await adminEbook.createSubscription({
      customerId: d.customerId,
      ebookId: d.ebookId,
      planId: d.planId ?? null,
      durationInDays: d.durationInDays,
      paymentMethod: d.paymentMethod,
      orderPrice: d.orderPrice,
      razorpayOrderId: d.razorpayOrderId ?? null,
      razorpayPaymentId: d.razorpayPaymentId ?? null,
      transactionId: d.transactionId ?? null,
      ipAddress: req.ip ?? null,
      remarks: d.remarks ?? null,
      status: d.status,
    });
    if (!result.ok) {
      const msg = result.reason === "ebook" ? "Ebook not found" : "Plan not found";
      return res.status(404).json({ success: false, message: msg });
    }
    return res.status(201).json({ success: true, data: result.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;

    const validatedData = updateEbookSubscriptionSchema.parse(req.body);

    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    const result = await adminEbook.updateSubscription(numId, {
      razorpayOrderId: validatedData.razorpayOrderId,
      razorpayPaymentId: validatedData.razorpayPaymentId,
      remarks: validatedData.remarks,
      status: validatedData.status,
    });
    if (result === "not_found") return res.status(404).json({ success: false, message: "Subscription not found" });
    if (result === "order_not_found") return res.status(404).json({ success: false, message: "Order not found" });
    if (result === "already_active") return res.status(400).json({ success: false, message: "Subscription is already active" });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    const ok = await adminEbook.deleteSubscription(numId);
    if (!ok) return res.status(404).json({ success: false, message: "Subscription not found" });
    return res.status(200).json({ success: true, message: "Subscription deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEbookPricesForSubscription = async (req: Request, res: Response) => {
  try {
    const ebookId = req.params.ebookId as string;
    const numId = adminEbook.parseEbookId(ebookId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    const res2 = await adminEbook.getEbookPricesForSubscription(numId);
    // Mongo returns [] for a missing ebook (no 404) — keep that contract.
    return res.status(200).json({ success: true, data: res2 === "not_found" ? [] : res2 });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
