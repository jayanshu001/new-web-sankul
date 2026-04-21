import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listBanners, createBanner, updateBanner, deleteBanner, reorderBanners,
  listCities, getCity, createCity, updateCity, deleteCity,
  listCenters, getCenter, createCenter, updateCenter, deleteCenter,
  listBatches, getBatch, createBatch, updateBatch, deleteBatch,
  listEnquiries, deleteEnquiry,
} from "./offline.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Banners
router.get("/banners", listBanners);
router.post("/banners", createBanner);
router.post("/banners/reorder", reorderBanners);
router.put("/banners/:id", updateBanner);
router.delete("/banners/:id", deleteBanner);

// Cities
router.get("/cities", listCities);
router.post("/cities", createCity);
router.get("/cities/:id", getCity);
router.put("/cities/:id", updateCity);
router.delete("/cities/:id", deleteCity);

// Centers
router.get("/centers", listCenters);
router.post("/centers", createCenter);
router.get("/centers/:id", getCenter);
router.put("/centers/:id", updateCenter);
router.delete("/centers/:id", deleteCenter);

// Batches
router.get("/batches", listBatches);
router.post("/batches", createBatch);
router.get("/batches/:id", getBatch);
router.put("/batches/:id", updateBatch);
router.delete("/batches/:id", deleteBatch);

// Enquiries (read/delete only — created from client)
router.get("/enquiries", listEnquiries);
router.delete("/enquiries/:id", deleteEnquiry);

export default router;
