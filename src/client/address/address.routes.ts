import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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
const REF = { ttl: 86400, scope: "shared" as const };
router.get("/states", cacheRoute(REF), getStates);
// router.get("/states/:stateId/districts", getDistrictsByState); // deprecated
router.get("/cities", cacheRoute(REF), listCities);
router.get("/cities/:cityId/centers", cacheRoute(REF), listCentersByCity);
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
