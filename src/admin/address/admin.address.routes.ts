import { Router } from "express";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";

import {
  getStates,
  createState,
  updateState,
  deleteState,
} from "../customer-master/customer-master.controller";

// Cities are sourced from ws_customer_distict (districts), not ws_offline_city.
// Same request/response contract; see admin.cities.controller for the mapping.
import {
  listCities,
  getCity,
  createCity,
  updateCity,
  deleteCity,
} from "./admin.cities.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// ─── States ───────────────────────────────────────────────────────────────────
router.get("/states", getStates);
// These lookups are cached shared+24h on client/address (states, cities,
// educations, characteristic). NOTE: "/cities" here is ws_customer_distict
// (districts) — a DIFFERENT table from admin/offline's /cities
// (ws_offline_city), which is why they carry different tags.
router.post("/states", autoFlushGroup(CacheEntity.CustomerLookup), createState);
router.put("/states/:id", autoFlushGroup(CacheEntity.CustomerLookup), updateState);
router.delete("/states/:id", autoFlushGroup(CacheEntity.CustomerLookup), deleteState);

// ─── Cities ───────────────────────────────────────────────────────────────────
router.get("/cities", listCities);
router.post("/cities", autoFlushGroup(CacheEntity.CustomerLookup), uploadS3.single("image"), createCity);
router.get("/cities/:id", getCity);
router.put("/cities/:id", autoFlushGroup(CacheEntity.CustomerLookup), uploadS3.single("image"), updateCity);
router.delete("/cities/:id", autoFlushGroup(CacheEntity.CustomerLookup), deleteCity);

export default router;
