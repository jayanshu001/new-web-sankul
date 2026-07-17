import { Request, Response } from "express";
import {
  createAddressSchemaMysql,
  updateAddressSchemaMysql,
} from "./address.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { matchesAllTokens } from "../../utils/searchFilter";
import {
  parseOfflineId,
  getCentersWithBatchesByCities as getCentersWithBatchesByCitiesMysql,
} from "../../modules/offline-batch/offline-batch.service";
import {
  listStates as lookupListStates,
  listEducations as lookupListEducations,
  listActiveCitiesFromDistricts as svcListCityDistricts,
} from "../../modules/customer-lookups/customer-lookups.service";
import {
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
  resolveCityName as svcResolveCityName,
} from "../../modules/offline-city/offline-city.service";
import { getActiveGoals } from "../goal/goal.client.service";

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

/**
 * Resolve the denormalized city NAME for storage. Clients send the dropdown
 * `cityId` (from `GET /client/address/cities`) rather than the city name, so when
 * `city` is omitted we look the name up from `cityId` (same resolution the cart
 * shipping snapshot uses). Returns "" when neither yields a name.
 */
const resolveCityForStore = async (city?: string | null, cityId?: unknown): Promise<string> => {
  const explicit = (city ?? "").trim();
  if (explicit) return explicit;
  if (cityId != null && cityId !== "") {
    const resolved = await svcResolveCityName(cityId as string | number);
    if (resolved?.name) return resolved.name;
  }
  return "";
};

// ─── Addresses ────────────────────────────────────────────────────────────────

export const getMyAddresses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getMyAddresses invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const cid = parseAddressId(String(customerId));
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const addresses = await svcListAddresses(cid);
    logger.info("getMyAddresses success", { traceId, customerId, count: addresses.length, source: "mysql" });
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
    const cid = parseAddressId(String(customerId));
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    // MySQL ids are integers, not ObjectIds — validate with the int-id schema.
    const data = createAddressSchemaMysql.parse(req.body);
    // `city` (VARCHAR NOT NULL) is derived from `cityId` when the client omits it.
    const city = await resolveCityForStore(data.city, data.cityId);
    if (!city) {
      logger.warn("createAddress missing city", { traceId, customerId });
      return res.status(400).json({
        success: false,
        message: "City is required. Provide `city` or a valid `cityId`.",
      });
    }
    const input: AddressCreateInput = toAddressCreateInput({ ...data, city }, cid);
    const address = await svcCreateAddress(input);
    logger.info("createAddress success", { traceId, customerId, addressId: address._id, source: "mysql" });
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
    const cid = parseAddressId(String(customerId));
    const aid = parseAddressId(id);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (!aid) {
      logger.warn("updateAddress invalid id", { traceId, customerId, id });
      return res.status(400).json({ success: false, message: "Invalid Address ID" });
    }
    const data = updateAddressSchemaMysql.parse(req.body);
    // If the client changes `cityId` without sending `city`, refresh the stored
    // city NAME from the new id (city column is NOT NULL — never write empty).
    let cityUpdate: string | undefined;
    if (data.city !== undefined || data.cityId !== undefined) {
      const resolved = await resolveCityForStore(data.city, data.cityId);
      if (resolved) cityUpdate = resolved;
    }
    const input: AddressUpdateInput = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.alternatePhone !== undefined ? { alternatePhone: data.alternatePhone } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      ...(data.address2 !== undefined ? { address2: data.address2 } : {}),
      ...(cityUpdate !== undefined ? { city: cityUpdate } : {}),
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
    const { search } = parseListQuery(req.query);
    const term = search;

    const rows = await lookupListStates({ activeOnly: true, search: term });
    // Project to the exact Mongo contract: { _id, name, stateCode }
    const states = rows.map((s) => ({ _id: s._id, name: s.name, stateCode: s.stateCode }));
    logger.info("getStates success", { traceId, count: states.length, source: "mysql" });
    return res.status(200).json({ success: true, data: states });
  } catch (error: any) {
    logger.error("getStates failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Districts (deprecated — removed in favour of /cities) ────────────────────

// ─── Cities (moved from /offline) ─────────────────────────────────────────────

export const listCities = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCities invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { stateId } = req.query as Record<string, string>;
    const { search } = parseListQuery(req.query);

    // Optional state scope. Invalid stateId → 400.
    let stateNum: number | undefined;
    if (stateId) {
      const n = Number(stateId);
      if (!Number.isInteger(n) || n <= 0) {
        return res.status(400).json({ success: false, message: "Invalid stateId." });
      }
      stateNum = n;
    }
    // Cities are sourced from ws_customer_distict (districts), shaped to the
    // offline-city contract — same fields/filters as before.
    const data = await svcListCityDistricts(search, stateNum);
    logger.info("listCities success", { traceId, count: data.length, source: "mysql", stateId: stateNum ?? null });
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
    // ── MySQL: centers (each with nested active batches) under this city
    // (offline-batch). SQL ids are ints, not 24-hex ObjectIds. Mirrors the
    // vetted SQL twin in offline.controller; pagination is applied in-memory
    // over the returned centers to preserve this route's response envelope.
    const cid = parseOfflineId(cityId);
    if (cid == null) {
      logger.warn("listCentersByCity invalid id", { traceId, cityId });
      return res.status(400).json({ success: false, message: "Invalid city id." });
    }

    const { search, page, limit, skip } = parseListQuery(req.query);
    const byCity = await getCentersWithBatchesByCitiesMysql([cid]);
    let all = byCity.get(String(cid)) ?? [];
    if (search) {
      all = all.filter((c: any) => matchesAllTokens(search, [String(c?.name ?? "")]));
    }
    const total = all.length;
    const data = all.slice(skip, skip + limit);

    logger.info("listCentersByCity success", { traceId, cityId, centerCount: data.length, total, source: "mysql" });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
  } catch (e: any) {
    logger.error("listCentersByCity failed", { traceId, cityId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getEducations = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getEducations invoked", { traceId, path: req.originalUrl });

  try {
    const rows = await lookupListEducations({ activeOnly: true });
    // Project to the exact Mongo contract: { _id, name }
    const educations = rows.map((e) => ({ _id: e._id, name: e.name }));
    logger.info("getEducations success", { traceId, count: educations.length, source: "mysql" });
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
    const educationsPromise = lookupListEducations({ activeOnly: true }).then((rows) =>
      rows.map((e) => ({ _id: e._id, name: e.name }))
    );

    const goalsPromise = getActiveGoals(traceId);

    const [educations, goals] = await Promise.all([
      educationsPromise,
      goalsPromise,
    ]);
    logger.info("getCharacteristic success", { traceId, educations: educations.length, goals: goals.length });
    return res.status(200).json({ success: true, data: { educations, goals } });
  } catch (error: any) {
    logger.error("getCharacteristic failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
