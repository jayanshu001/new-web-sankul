import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getMyAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  getStates,
  // getDistrictsByState, // deprecated — use /cities instead
  listCities,
  listCentersByCity,
  getEducations,
  getCharacteristic,
} from "./address.controller";

const router = Router();

// Public location dropdowns (no auth required)
router.get("/states", getStates);
// router.get("/states/:stateId/districts", getDistrictsByState); // deprecated
router.get("/cities", listCities);
router.get("/cities/:cityId/centers", listCentersByCity);
router.get("/educations", getEducations);
router.get("/characteristic", getCharacteristic);

// Address CRUD (auth required)
router.get("/", authenticate, getMyAddresses);
router.post("/", authenticate, createAddress);
router.get("/:id", authenticate, getAddressById);
router.put("/:id", authenticate, updateAddress);
router.delete("/:id", authenticate, deleteAddress);

export default router;
