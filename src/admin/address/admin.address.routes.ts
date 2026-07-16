import { Router } from "express";
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
router.post("/states", createState);
router.put("/states/:id", updateState);
router.delete("/states/:id", deleteState);

// ─── Cities ───────────────────────────────────────────────────────────────────
router.get("/cities", listCities);
router.post("/cities", uploadS3.single("image"), createCity);
router.get("/cities/:id", getCity);
router.put("/cities/:id", uploadS3.single("image"), updateCity);
router.delete("/cities/:id", deleteCity);

export default router;
