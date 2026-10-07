// Client addresses: address book CRUD and location dropdown routes.
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
  listCities,
  listCentersByCity,
  getEducations,
  getCharacteristic,
} from "./address.controller";

const router = Router();

// Public location dropdowns (no auth). Address CRUD below is per-user. Flushed by
// admin/address + admin/customer-master writes, and by admin/goal (getActiveGoals
// embeds customerTargetGoal rows).
const REF = { ttl: CACHE_TTL.DAY, entity: CacheEntity.CustomerLookup as const, scope: CacheScope.Shared as const };
// /cities/:cityId/centers returns offline centres (same data as client/offline), so it
// carries the "offline" tag and is swept by admin/offline writes.
const REF_OFFLINE = { ttl: CACHE_TTL.DAY, entity: CacheEntity.Offline as const, scope: CacheScope.Shared as const };
router.get("/states", cacheRoute(REF), getStates);
router.get("/cities", cacheRoute(REF), listCities);
router.get("/cities/:cityId/centers", cacheRoute(REF_OFFLINE), listCentersByCity);
router.get("/educations", cacheRoute(REF), getEducations);
router.get("/characteristic", cacheRoute(REF), getCharacteristic);

router.get("/", authenticate, getMyAddresses);
router.post("/", authenticate, createAddress);
router.get("/:id", authenticate, getAddressById);
router.put("/:id", authenticate, updateAddress);
router.patch("/:id/default", authenticate, setDefaultAddress);
router.delete("/:id", authenticate, deleteAddress);

export default router;
