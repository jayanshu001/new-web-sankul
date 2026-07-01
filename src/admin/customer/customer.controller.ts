import { Request, Response } from "express";
import { createCustomerSchema, updateCustomerSchema, updateSubscriptionDatesSchema } from "./customer.validation";
import { invalidateCustomerGate } from "../../middlewares/authenticate";
import * as customerSql from "../../modules/admin-customer/admin-customer.service";
import { parseSubscriptionId, updateSubscriptionEndAt } from "../../modules/commerce-subscription/commerce-subscription.service";
import { getCustomerPurchaseDetails } from "../../modules/admin-customer/admin-customer-details.service";

const parseStatusFilter = (status?: string): boolean | undefined => {
  if (status === "true" || status === "active") return true;
  if (status === "false" || status === "inactive") return false;
  return undefined;
};

// ─── List & Get ───────────────────────────────────────────────────────────────

export const getCustomers = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      districtId,
      stateId,
      fromDate,
      toDate,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    const { items, total } = await customerSql.listCustomers({
      search,
      status: parseStatusFilter(status),
      stateId,
      districtId,
      fromDate,
      toDate,
      page: pageNum,
      limit: limitNum,
    });
    return res.status(200).json({
      success: true,
      data: items,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCustomerById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = customerSql.parseCustomerId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    const dto = await customerSql.getCustomer(numId);
    if (!dto) return res.status(404).json({ success: false, message: "Customer not found" });
    // Subscription/ebook models are not yet on SQL; counts default to 0.
    return res.status(200).json({
      success: true,
      data: { ...dto, courseSubCount: 0, ebookSubCount: 0 },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Pre-requisites ───────────────────────────────────────────────────────────

export const getCustomerPreRequisites = async (_req: Request, res: Response) => {
  try {
    const data = await customerSql.getPreRequisites();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getDistrictsByState = async (req: Request, res: Response) => {
  try {
    const stateId = req.params.stateId as string;

    const numId = customerSql.parseCustomerId(stateId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid stateId" });
    const data = await customerSql.getDistrictsByState(numId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const createCustomer = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.profilePicture = file.location;
    const validatedData = createCustomerSchema.parse(req.body);

    if (await customerSql.phoneInUse(validatedData.phoneNumber)) {
      return res.status(409).json({ success: false, message: "Phone number already registered" });
    }
    if (validatedData.emailAddress && (await customerSql.emailInUse(validatedData.emailAddress))) {
      return res.status(409).json({ success: false, message: "Email address already registered" });
    }
    const created = await customerSql.createCustomer(validatedData);
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.code === 11000) return res.status(409).json({ success: false, message: "Phone number already registered" });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const file = req.file as any;
    if (file?.location) req.body.profilePicture = file.location;
    const validatedData = updateCustomerSchema.parse(req.body);

    const numId = customerSql.parseCustomerId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Customer ID" });

    const existing = await customerSql.getCustomer(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Customer not found" });

    if (validatedData.emailAddress && (await customerSql.emailInUse(validatedData.emailAddress, numId))) {
      return res.status(409).json({ success: false, message: "Email address already in use" });
    }
    if (validatedData.phoneNumber && (await customerSql.phoneInUse(validatedData.phoneNumber, numId))) {
      return res.status(409).json({ success: false, message: "Phone number already registered" });
    }

    const updated = await customerSql.updateCustomer(numId, validatedData);
    // Status/deletion may have changed → drop the cached auth gate so it bites now.
    await invalidateCustomerGate(numId);
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = customerSql.parseCustomerId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    const existing = await customerSql.getCustomer(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Customer not found" });
    await customerSql.softDeleteCustomer(numId);
    return res.status(200).json({ success: true, message: "Customer deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleCustomerStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = customerSql.parseCustomerId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    const existing = await customerSql.getCustomer(numId);
    if (!existing) return res.status(404).json({ success: false, message: "Customer not found" });
    const newStatus = !existing.status;
    await customerSql.setCustomerStatus(numId, newStatus);
    return res.status(200).json({ success: true, data: { status: newStatus } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const getCustomerCourseSubscriptions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!customerSql.parseCustomerId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    // Subscription models are not yet on SQL — return an empty page on the
    // ws_customer branch so the admin detail view degrades gracefully.
    return res.status(200).json({
      success: true,
      data: [],
      pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCustomerEbookSubscriptions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!customerSql.parseCustomerId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    // Ebook-subscription model not yet on SQL — empty page on ws_customer branch.
    return res.status(200).json({
      success: true,
      data: [],
      pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCustomerAddresses = async (_req: Request, res: Response) => {
  try {
    // Address admin view not yet on SQL — empty list on ws_customer branch.
    return res.status(200).json({ success: true, data: [] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Customer Details (aggregate for admin detail page) ──────────────────────

export const getCustomerDetails = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Profile + purchase aggregates (subscriptions/orders/addresses) all from SQL.
    // The aggregate is built to match the Mongo handler's DTO shape exactly.
    const numId = customerSql.parseCustomerId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    const profile = await customerSql.getCustomer(numId);
    if (!profile) return res.status(404).json({ success: false, message: "Customer not found" });
    const { addresses, purchases, summary } = await getCustomerPurchaseDetails(numId, new Date());
    return res.status(200).json({
      success: true,
      data: { profile, addresses, purchases, summary },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCourseSubscriptionDates = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    const subId = parseSubscriptionId(subscriptionId);
    if (subId == null) {
      return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    }

    const { endAt } = updateSubscriptionDatesSchema.parse(req.body);

    const sub = await updateSubscriptionEndAt(subId, new Date(endAt));
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found" });

    return res.status(200).json({ success: true, data: sub });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};
