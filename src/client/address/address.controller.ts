import { Request, Response } from "express";
import mongoose from "mongoose";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { CustomerState } from "../../models/customer/CustomerState.model";
// District module is deprecated in favour of OfflineCity-based "City" lookups below.
// import { CustomerDistrict } from "../../models/customer/CustomerDistrict.model";
import { OfflineCity } from "../../models/offline/OfflineCity.model";
import { OfflineCenter } from "../../models/offline/OfflineCenter.model";
import { OfflineBatch } from "../../models/offline/OfflineBatch.model";
import { CustomerEducation } from "../../models/customer/CustomerEducation.model";
import { Goal } from "../../models/Goal.model";
import { createAddressSchema, updateAddressSchema } from "./address.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildRegexCondition } from "../../utils/searchFilter";

// ─── Addresses ────────────────────────────────────────────────────────────────

export const getMyAddresses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getMyAddresses invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const addresses = await CustomerAddress.find({ customerId, status: true })
      .populate("stateId")
      .populate("cityId")
      .sort({ createdAt: -1 });
    logger.info("getMyAddresses success", { traceId, customerId, count: addresses.length });
    return res.status(200).json({ success: true, data: addresses });
  } catch (error: any) {
    logger.error("getMyAddresses failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAddressById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getAddressById invoked", { traceId, path: req.originalUrl, customerId, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getAddressById invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid Address ID" });
    }

    const address = await CustomerAddress.findOne({ _id: id, customerId })
      .populate("stateId", "_id name stateCode")
      .populate("cityId", "_id name");

    if (!address) {
      logger.warn("getAddressById not found", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Address not found" });
    }
    logger.info("getAddressById success", { traceId, customerId, id });
    return res.status(200).json({ success: true, data: address });
  } catch (error: any) {
    logger.error("getAddressById failed", { traceId, customerId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createAddress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createAddress invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const data = createAddressSchema.parse(req.body);
    const address = new CustomerAddress({ ...data, customerId });
    await address.save();
    logger.info("createAddress success", { traceId, customerId, addressId: address._id });
    return res.status(201).json({ success: true, data: address });
  } catch (error: any) {
    if (error.issues) {
      logger.warn("createAddress validation failed", { traceId, customerId, issues: error.issues });
      return res.status(400).json({ success: false, errors: error.issues });
    }
    logger.error("createAddress failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAddress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("updateAddress invoked", { traceId, path: req.originalUrl, customerId, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("updateAddress invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid Address ID" });
    }

    const data = updateAddressSchema.parse(req.body);
    const address = await CustomerAddress.findOneAndUpdate(
      { _id: id, customerId },
      { $set: data },
      { new: true }
    ).populate("stateId", "_id name stateCode");

    if (!address) {
      logger.warn("updateAddress not found", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Address not found" });
    }
    logger.info("updateAddress success", { traceId, customerId, id });
    return res.status(200).json({ success: true, data: address });
  } catch (error: any) {
    if (error.issues) {
      logger.warn("updateAddress validation failed", { traceId, customerId, id, issues: error.issues });
      return res.status(400).json({ success: false, errors: error.issues });
    }
    logger.error("updateAddress failed", { traceId, customerId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/v1/client/address/:id/default
export const setDefaultAddress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("setDefaultAddress invoked", { traceId, path: req.originalUrl, customerId, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("setDefaultAddress invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid Address ID" });
    }

    const target = await CustomerAddress.findOne({ _id: id, customerId, status: true });
    if (!target) {
      logger.warn("setDefaultAddress not found", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Address not found" });
    }

    await CustomerAddress.updateMany(
      { customerId, _id: { $ne: id } },
      { $set: { isDefault: false } }
    );
    target.isDefault = true;
    await target.save();

    logger.info("setDefaultAddress success", { traceId, customerId, id });
    return res.status(200).json({
      success: true,
      message: "Default address updated.",
    });
  } catch (error: any) {
    logger.error("setDefaultAddress failed", { traceId, customerId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteAddress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("deleteAddress invoked", { traceId, path: req.originalUrl, customerId, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("deleteAddress invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid Address ID" });
    }

    const address = await CustomerAddress.findOneAndUpdate(
      { _id: id, customerId },
      { $set: { status: false } },
      { new: true }
    );
    if (!address) {
      logger.warn("deleteAddress not found", { traceId, customerId, id });
      return res.status(404).json({ success: false, message: "Address not found" });
    }
    logger.info("deleteAddress success", { traceId, customerId, id });
    return res.status(200).json({ success: true, message: "Address removed successfully" });
  } catch (error: any) {
    logger.error("deleteAddress failed", { traceId, customerId, id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Location Dropdowns ───────────────────────────────────────────────────────

export const getStates = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getStates invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const filter: any = { active: true };
    { const c = buildRegexCondition(search); if (c) filter.name = c; }
    const states = await CustomerState.find(filter)
      .select("_id name stateCode")
      .sort({ name: 1 });
    logger.info("getStates success", { traceId, count: states.length });
    return res.status(200).json({ success: true, data: states });
  } catch (error: any) {
    logger.error("getStates failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Districts (deprecated — kept commented out in favour of /cities) ─────────
// export const getDistrictsByState = async (req: Request, res: Response) => {
//   try {
//     const stateId = req.params.stateId as string;
//     if (!mongoose.Types.ObjectId.isValid(stateId))
//       return res.status(400).json({ success: false, message: "Invalid stateId" });
//     const districts = await CustomerDistrict.find({ stateId, active: true })
//       .select("_id name")
//       .sort({ name: 1 });
//     return res.status(200).json({ success: true, data: districts });
//   } catch (error: any) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

// ─── Cities (moved from /offline) ─────────────────────────────────────────────

export const listCities = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCities invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const filter: any = { status: true };
    { const c = buildRegexCondition(search); if (c) filter.name = c; }
    const data = await OfflineCity.find(filter).sort({ order: 1, name: 1 }).lean();
    logger.info("listCities success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listCities failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const listCentersByCity = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const cityId = req.params.cityId as string;
  logger.info("listCentersByCity invoked", { traceId, path: req.originalUrl, cityId, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      logger.warn("listCentersByCity invalid id", { traceId, cityId });
      return res.status(400).json({ success: false, message: "Invalid city id." });
    }

    const centers = await OfflineCenter.find({ cityId, status: true }).lean();
    const centerIds = centers.map((c) => c._id);
    const batches = await OfflineBatch.find({ centerId: { $in: centerIds }, status: true })
      .sort({ startAt: 1 })
      .lean();

    const batchesByCenter: Record<string, any[]> = {};
    batches.forEach((b) => {
      (batchesByCenter[String(b.centerId)] ||= []).push(b);
    });

    const data = centers.map((c: any) => ({
      ...c,
      batches: batchesByCenter[String(c._id)] || [],
    }));

    logger.info("listCentersByCity success", { traceId, cityId, centerCount: centers.length, batchCount: batches.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listCentersByCity failed", { traceId, cityId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getEducations = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getEducations invoked", { traceId, path: _req.originalUrl });

  try {
    const educations = await CustomerEducation.find({ status: true })
      .select("_id name")
      .sort({ name: 1 });
    logger.info("getEducations success", { traceId, count: educations.length });
    return res.status(200).json({ success: true, data: educations });
  } catch (error: any) {
    logger.error("getEducations failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/client/address/characteristic
 * Returns educations + active goals for onboarding screens. No auth.
 */
export const getCharacteristic = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getCharacteristic invoked", { traceId, path: _req.originalUrl });

  try {
    const [educations, goals] = await Promise.all([
      CustomerEducation.find({ status: true }).select("_id name").sort({ name: 1 }),
      Goal.find({ isActive: true }).select("title image labels").sort({ createdAt: 1 }),
    ]);
    logger.info("getCharacteristic success", { traceId, educations: educations.length, goals: goals.length });
    return res.status(200).json({ success: true, data: { educations, goals } });
  } catch (error: any) {
    logger.error("getCharacteristic failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
