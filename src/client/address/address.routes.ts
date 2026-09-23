import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  getMyAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  getStates,
  // getDistrictsByState, // deprecated — use /cities instead
  listCities,
  listCentersByCity,
  getEducations,
  getCharacteristic,
} from "./address.controller";

const router = Router();

// Public location dropdowns (no auth required). Tier-1 shared reference data;
// no dedicated entity tag → "misc", long TTL. Address CRUD below is per-user.
// Customer reference lookups — flushed by admin/address + admin/customer-master
// writes (states, districts, educations) and by admin/goal (characteristic embeds
// customerTargetGoal rows via getActiveGoals, so "goal" fans out to this tag).
const REF = { ttl: CACHE_TTL.DAY, entity: CacheEntity.CustomerLookup as const, scope: CacheScope.Shared as const };
// NOT a customer lookup: /cities/:cityId/centers returns OFFLINE centres (the
// same getCentersWithBatchesByCitiesMysql data as client/offline), so it carries
// the "offline" tag and is swept by admin/offline writes instead.
const REF_OFFLINE = { ttl: CACHE_TTL.DAY, entity: CacheEntity.Offline as const, scope: CacheScope.Shared as const };
router.get("/states", cacheRoute(REF), getStates);
// router.get("/states/:stateId/districts", getDistrictsByState); // deprecated
router.get("/cities", cacheRoute(REF), listCities);
router.get("/cities/:cityId/centers", cacheRoute(REF_OFFLINE), listCentersByCity);
router.get("/educations", cacheRoute(REF), getEducations);
router.get("/characteristic", cacheRoute(REF), getCharacteristic);

// Address CRUD (auth required)
router.get("/", authenticate, getMyAddresses);
router.post("/", authenticate, createAddress);
router.get("/:id", authenticate, getAddressById);
router.put("/:id", authenticate, updateAddress);
router.patch("/:id/default", authenticate, setDefaultAddress);
router.delete("/:id", authenticate, deleteAddress);

export default router;
