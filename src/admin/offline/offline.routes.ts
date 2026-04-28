import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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
router.post("/banners", uploadS3.single("image"), createBanner);
router.post("/banners/reorder", reorderBanners);
router.put("/banners/:id", uploadS3.single("image"), updateBanner);
router.delete("/banners/:id", deleteBanner);

// Cities — moved to /api/v1/admin/address/cities (see admin/address/admin.address.routes.ts)
// router.get("/cities", listCities);
// router.post("/cities", uploadS3.single("image"), createCity);
// router.get("/cities/:id", getCity);
// router.put("/cities/:id", uploadS3.single("image"), updateCity);
// router.delete("/cities/:id", deleteCity);

// Centers
router.get("/centers", listCenters);
router.post("/centers", uploadS3.array("images", 10), createCenter);
router.get("/centers/:id", getCenter);
router.put("/centers/:id", uploadS3.array("images", 10), updateCenter);
router.delete("/centers/:id", deleteCenter);

// Batches
router.get("/batches", listBatches);
router.post("/batches", uploadS3.single("image"), createBatch);
router.get("/batches/:id", getBatch);
router.put("/batches/:id", uploadS3.single("image"), updateBatch);
router.delete("/batches/:id", deleteBatch);

// Enquiries (read/delete only — created from client)
router.get("/enquiries", listEnquiries);
router.delete("/enquiries/:id", deleteEnquiry);

export default router;
