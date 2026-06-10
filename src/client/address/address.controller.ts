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
import {
  createAddressSchema,
  updateAddressSchema,
  createAddressSchemaMysql,
  updateAddressSchemaMysql,
} from "./address.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { isMysqlModule } from "../../config/migration";
import {
  listStates as lookupListStates,
  listEducations as lookupListEducations,
} from "../../modules/customer-lookups/customer-lookups.service";
import {
  isAddressMysql,
  parseAddressId,
  listAddresses as svcListAddresses,
  getAddress as svcGetAddress,
  createAddress as svcCreateAddress,
  updateAddress as svcUpdateAddress,
  deleteAddress as svcDeleteAddress,
  setDefaultAddress as svcSetDefaultAddress,
} from "../../modules/customer-address/customer-address.service";
import type {
  AddressCreateInput,
  AddressUpdateInput,
} from "../../modules/customer-address/customer-address.types";
import {
  isOfflineCityMysql,
  listActiveCities as svcListActiveCities,
} from "../../modules/offline-city/offline-city.service";

const LOOKUPS_MODULE = "customer-lookups";

/**
 * Map the validated zod body → the MySQL service's normalized input.
 * MySQL ids are integers (cityId/stateId), unlike the Mongo ObjectId space — the
 * zod schema's objectId regex is bypassed on the MySQL branch (see each handler).
 */
const toAddressCreateInput = (body: any, customerId: number): AddressCreateInput => ({
  customerId,
  name: body.name,
  phone: body.phone ?? null,
  alternatePhone: body.alternatePhone ?? null,
  email: body.email ?? null,
  address: body.address,
  address2: body.address2 ?? "",
  city: body.city,
  stateId: body.stateId != null && body.stateId !== "" ? Number(body.stateId) : null,
  cityId: body.cityId != null && body.cityId !== "" ? Number(body.cityId) : null,
  pincode: body.pincode,
  label: body.label ?? null,
  status: body.status ?? true,
});

// ─── Addresses ────────────────────────────────────────────────────────────────

export const getMyAddresses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getMyAddresses invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (isAddressMysql()) {
      const cid = parseAddressId(String(customerId));
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
      const addresses = await svcListAddresses(cid);
      logger.info("getMyAddresses success", { traceId, customerId, count: addresses.length, source: "mysql" });
      return res.status(200).json({ success: true, data: addresses });
    }

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
    if (isAddressMysql()) {
      const cid = parseAddressId(String(customerId));
      const aid = parseAddressId(id);
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
      if (!aid) {
        logger.warn("getAddressById invalid id", { traceId, customerId, id });
        return res.status(400).json({ success: false, message: "Invalid Address ID" });
      }
      const address = await svcGetAddress(aid, cid);
      if (!address) {
        logger.warn("getAddressById not found", { traceId, customerId, id });
        return res.status(404).json({ success: false, message: "Address not found" });
      }
      logger.info("getAddressById success", { traceId, customerId, id, source: "mysql" });
      return res.status(200).json({ success: true, data: address });
    }

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
    if (isAddressMysql()) {
      const cid = parseAddressId(String(customerId));
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
      // MySQL ids are integers, not ObjectIds — validate with the int-id schema.
      const data = createAddressSchemaMysql.parse(req.body);
      const input: AddressCreateInput = toAddressCreateInput(data, cid);
      const address = await svcCreateAddress(input);
      logger.info("createAddress success", { traceId, customerId, addressId: address._id, source: "mysql" });
      return res.status(201).json({ success: true, data: address });
    }

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
    if (isAddressMysql()) {
      const cid = parseAddressId(String(customerId));
      const aid = parseAddressId(id);
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
      if (!aid) {
        logger.warn("updateAddress invalid id", { traceId, customerId, id });
        return res.status(400).json({ success: false, message: "Invalid Address ID" });
      }
      const data = updateAddressSchemaMysql.parse(req.body);
      const input: AddressUpdateInput = {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.alternatePhone !== undefined ? { alternatePhone: data.alternatePhone } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.address2 !== undefined ? { address2: data.address2 } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.stateId !== undefined
          ? { stateId: data.stateId != null ? Number(data.stateId) : null }
          : {}),
        ...(data.cityId !== undefined
          ? { cityId: data.cityId != null ? Number(data.cityId) : null }
          : {}),
        ...(data.pincode !== undefined ? { pincode: data.pincode } : {}),
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      };
      const result = await svcUpdateAddress(aid, cid, input);
      if (!result.ok) {
        logger.warn("updateAddress not found", { traceId, customerId, id });
        return res.status(result.status).json({ success: false, message: result.message });
      }
      logger.info("updateAddress success", { traceId, customerId, id, source: "mysql" });
      return res.status(result.status).json({ success: true, data: result.data });
    }

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
    if (isAddressMysql()) {
      const cid = parseAddressId(String(customerId));
      const aid = parseAddressId(id);
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
      if (!aid) {
        logger.warn("setDefaultAddress invalid id", { traceId, customerId, id });
        return res.status(400).json({ success: false, message: "Invalid Address ID" });
      }
      const result = await svcSetDefaultAddress(aid, cid);
      if (!result.ok) {
        logger.warn("setDefaultAddress not found", { traceId, customerId, id });
        return res.status(result.status).json({ success: false, message: result.message });
      }
      logger.info("setDefaultAddress success", { traceId, customerId, id, source: "mysql" });
      return res.status(200).json({ success: true, message: "Default address updated." });
    }

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
    if (isAddressMysql()) {
      const cid = parseAddressId(String(customerId));
      const aid = parseAddressId(id);
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
      if (!aid) {
        logger.warn("deleteAddress invalid id", { traceId, customerId, id });
        return res.status(400).json({ success: false, message: "Invalid Address ID" });
      }
      const result = await svcDeleteAddress(aid, cid);
      if (!result.ok) {
        logger.warn("deleteAddress not found", { traceId, customerId, id });
        return res.status(result.status).json({ success: false, message: result.message });
      }
      logger.info("deleteAddress success", { traceId, customerId, id, source: "mysql" });
      return res.status(200).json({ success: true, message: "Address removed successfully" });
    }

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
    const term = search && search.trim() ? search.trim() : undefined;

    if (isMysqlModule(LOOKUPS_MODULE)) {
      const rows = await lookupListStates({ activeOnly: true, search: term });
      // Project to the exact Mongo contract: { _id, name, stateCode }
      const states = rows.map((s) => ({ _id: s._id, name: s.name, stateCode: s.stateCode }));
      logger.info("getStates success", { traceId, count: states.length, source: "mysql" });
      return res.status(200).json({ success: true, data: states });
    }

    const filter: any = { active: true };
    if (term) filter.name = { $regex: term, $options: "i" };
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

    if (isOfflineCityMysql()) {
      const data = await svcListActiveCities(search);
      logger.info("listCities success", { traceId, count: data.length, source: "mysql" });
      return res.status(200).json({ success: true, data });
    }

    const filter: any = { status: true };
    if (search && search.trim()) filter.name = { $regex: search.trim(), $options: "i" };
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
    if (isMysqlModule(LOOKUPS_MODULE)) {
      const rows = await lookupListEducations({ activeOnly: true });
      // Project to the exact Mongo contract: { _id, name }
      const educations = rows.map((e) => ({ _id: e._id, name: e.name }));
      logger.info("getEducations success", { traceId, count: educations.length, source: "mysql" });
      return res.status(200).json({ success: true, data: educations });
    }

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
    // Educations honor the customer-lookups MySQL flag; goals (rich onboarding
    // Goal collection, not ws_customer_target_goal) stay on Mongo for now.
    const educationsPromise = isMysqlModule(LOOKUPS_MODULE)
      ? lookupListEducations({ activeOnly: true }).then((rows) =>
          rows.map((e) => ({ _id: e._id, name: e.name }))
        )
      : CustomerEducation.find({ status: true }).select("_id name").sort({ name: 1 });

    const [educations, goals] = await Promise.all([
      educationsPromise,
      Goal.find({ isActive: true }).select("title image labels").sort({ createdAt: 1 }),
    ]);
    logger.info("getCharacteristic success", { traceId, educations: educations.length, goals: goals.length });
    return res.status(200).json({ success: true, data: { educations, goals } });
  } catch (error: any) {
    logger.error("getCharacteristic failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
