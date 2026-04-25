import { Request, Response } from "express";
import mongoose from "mongoose";
import { Customer } from "../../models/customer/Customer.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { CustomerDistrict } from "../../models/customer/CustomerDistrict.model";
import { CustomerEducation } from "../../models/customer/CustomerEducation.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { createCustomerSchema, updateCustomerSchema, updateSubscriptionDatesSchema } from "./customer.validation";

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

    const filters: any = { isAccountDeleted: false };

    if (search) {
      filters.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { emailAddress: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") filters.status = status === "true";
    if (districtId && mongoose.Types.ObjectId.isValid(districtId)) filters.districtId = districtId;
    if (stateId && mongoose.Types.ObjectId.isValid(stateId)) filters.stateId = stateId;
    if (fromDate || toDate) {
      filters.createdAt = {};
      if (fromDate) filters.createdAt.$gte = new Date(fromDate);
      if (toDate) filters.createdAt.$lte = new Date(toDate);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Customer.find(filters)
        .select("-password -otp")
        .populate("stateId", "_id name")
        .populate("districtId", "_id name")
        .populate("educationId", "_id name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Customer.countDocuments(filters),
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

export const getCustomerById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const customer = await Customer.findOne({ _id: id, isAccountDeleted: false })
      .select("-password -otp")
      .populate("stateId", "_id name")
      .populate("districtId", "_id name")
      .populate("educationId", "_id name");

    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    const [courseSubCount, ebookSubCount] = await Promise.all([
      PackageCourseSubscription.countDocuments({ customerId: id }),
      EbookSubscription.countDocuments({ customerId: id }),
    ]);

    return res.status(200).json({
      success: true,
      data: { ...customer.toObject(), courseSubCount, ebookSubCount },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Pre-requisites ───────────────────────────────────────────────────────────

export const getCustomerPreRequisites = async (_req: Request, res: Response) => {
  try {
    const [states, educations] = await Promise.all([
      CustomerState.find({ active: true }).select("_id name stateCode").sort({ name: 1 }),
      CustomerEducation.find({ status: true }).select("_id name").sort({ name: 1 }),
    ]);
    return res.status(200).json({ success: true, data: { states, educations } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getDistrictsByState = async (req: Request, res: Response) => {
  try {
    const stateId = req.params.stateId as string;
    if (!mongoose.Types.ObjectId.isValid(stateId)) {
      return res.status(400).json({ success: false, message: "Invalid stateId" });
    }
    const districts = await CustomerDistrict.find({ stateId, active: true })
      .select("_id name")
      .sort({ name: 1 });
    return res.status(200).json({ success: true, data: districts });
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

    const phoneExists = await Customer.exists({ phoneNumber: validatedData.phoneNumber, isAccountDeleted: false });
    if (phoneExists) {
      return res.status(409).json({ success: false, message: "Phone number already registered" });
    }

    if (validatedData.emailAddress) {
      const emailExists = await Customer.exists({ emailAddress: validatedData.emailAddress, isAccountDeleted: false });
      if (emailExists) {
        return res.status(409).json({ success: false, message: "Email address already registered" });
      }
    }

    const customer = new Customer({ ...validatedData, verified: false, isPhoneVerified: false });
    await customer.save();

    const result = await Customer.findById(customer._id)
      .select("-password -otp")
      .populate("stateId", "_id name")
      .populate("districtId", "_id name")
      .populate("educationId", "_id name");

    return res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.code === 11000) return res.status(409).json({ success: false, message: "Phone number already registered" });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const file = req.file as any;
    if (file?.location) req.body.profilePicture = file.location;
    const validatedData = updateCustomerSchema.parse(req.body);

    if (validatedData.emailAddress) {
      const emailExists = await Customer.exists({
        emailAddress: validatedData.emailAddress,
        _id: { $ne: id },
        isAccountDeleted: false,
      });
      if (emailExists) {
        return res.status(409).json({ success: false, message: "Email address already in use" });
      }
    }

    if (validatedData.phoneNumber) {
      const phoneExists = await Customer.exists({
        phoneNumber: validatedData.phoneNumber,
        _id: { $ne: id },
        isAccountDeleted: false,
      });
      if (phoneExists) {
        return res.status(409).json({ success: false, message: "Phone number already registered" });
      }
    }

    const updatePayload: any = { ...validatedData };
    if (validatedData.dob) updatePayload.dob = new Date(validatedData.dob);
    if (validatedData.phoneNumber) updatePayload.isPhoneVerified = false;

    const customer = await Customer.findOneAndUpdate(
      { _id: id, isAccountDeleted: false },
      { $set: updatePayload },
      { new: true }
    )
      .select("-password -otp")
      .populate("stateId", "_id name")
      .populate("districtId", "_id name")
      .populate("educationId", "_id name");

    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    return res.status(200).json({ success: true, data: customer });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const customer = await Customer.findOneAndUpdate(
      { _id: id, isAccountDeleted: false },
      { $set: { isAccountDeleted: true, status: false } },
      { new: true }
    );
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    return res.status(200).json({ success: true, message: "Customer deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleCustomerStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const customer = await Customer.findOne({ _id: id, isAccountDeleted: false }).select("status");
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    customer.status = !customer.status;
    await customer.save();

    return res.status(200).json({ success: true, data: { status: customer.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const getCustomerCourseSubscriptions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      PackageCourseSubscription.find({ customerId: id })
        .populate("courseId", "_id name image level")
        .populate("packageId", "_id name duration price withMaterial")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      PackageCourseSubscription.countDocuments({ customerId: id }),
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

export const getCustomerEbookSubscriptions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const [data, total] = await Promise.all([
      EbookSubscription.find({ customerId: id })
        .populate("ebookId", "_id name author publisher")
        .populate("orderId", "_id paymentMethod orderPrice status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      EbookSubscription.countDocuments({ customerId: id }),
    ]);

    const enriched = data.map((sub) => ({
      ...sub.toObject(),
      isActive: sub.status && sub.endAt > now,
    }));

    return res.status(200).json({
      success: true,
      data: enriched,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCustomerAddresses = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    const addresses = await CustomerAddress.find({ customerId: id })
      .populate("stateId", "_id name stateCode")
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: addresses });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCourseSubscriptionDates = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    }

    const { endAt, remarks } = updateSubscriptionDatesSchema.parse(req.body);

    const sub = await PackageCourseSubscription.findByIdAndUpdate(
      subscriptionId,
      { $set: { endAt: new Date(endAt) } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found" });

    return res.status(200).json({ success: true, data: sub });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};
