// Admin offline centers: banner, city, center, batch and enquiry routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";
import {
  listBanners, createBanner, updateBanner, deleteBanner, reorderBanners,
  listCities, getCity, createCity, updateCity, deleteCity,
  listCenters, getCenter, createCenter, updateCenter, deleteCenter,
  listBatches, getBatch, createBatch, updateBatch, deleteBatch,
  listEnquiries, deleteEnquiry,
  listBatchEnquiries, deleteBatchEnquiry,
} from "./offline.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.get("/banners", listBanners);
router.post("/banners", uploadTo(UPLOAD_FOLDERS.offlineBanners), uploadS3.single("image"), createBanner);
router.post("/banners/reorder", reorderBanners);
router.put("/banners/:id", uploadTo(UPLOAD_FOLDERS.offlineBanners), uploadS3.single("image"), updateBanner);
router.delete("/banners/:id", deleteBanner);

// Offline cities (ws_offline_city) are distinct from /admin/address/cities
// (ws_customer_distict): offline centers/batches reference offline-city ids,
// customer addresses reference district ids. Do not conflate the two.
router.get("/cities", listCities);
router.post("/cities", autoFlushGroup(CacheEntity.Offline), uploadTo(UPLOAD_FOLDERS.offlineCities), uploadS3.single("image"), createCity);
router.get("/cities/:id", getCity);
router.put("/cities/:id", autoFlushGroup(CacheEntity.Offline), uploadTo(UPLOAD_FOLDERS.offlineCities), uploadS3.single("image"), updateCity);
router.delete("/cities/:id", autoFlushGroup(CacheEntity.Offline), deleteCity);

router.get("/centers", listCenters);
router.post("/centers", autoFlushGroup(CacheEntity.Offline), uploadTo(UPLOAD_FOLDERS.offlineCenters), uploadS3.array("images", 10), createCenter);
router.get("/centers/:id", getCenter);
router.put("/centers/:id", autoFlushGroup(CacheEntity.Offline), uploadTo(UPLOAD_FOLDERS.offlineCenters), uploadS3.array("images", 10), updateCenter);
router.delete("/centers/:id", autoFlushGroup(CacheEntity.Offline), deleteCenter);

router.get("/batches", listBatches);
router.post("/batches", autoFlushGroup(CacheEntity.Offline), uploadTo(UPLOAD_FOLDERS.offlineBatches), uploadS3.single("image"), createBatch);
router.get("/batches/:id", getBatch);
router.put("/batches/:id", autoFlushGroup(CacheEntity.Offline), uploadTo(UPLOAD_FOLDERS.offlineBatches), uploadS3.single("image"), updateBatch);
router.delete("/batches/:id", autoFlushGroup(CacheEntity.Offline), deleteBatch);

// Enquiries are created from the client; admin is read/delete only.
// `/batch-enquiries` is an admin-UI alias for `/enquiries`.
router.get("/enquiries", listEnquiries);
router.get("/batch-enquiries", listEnquiries);
router.delete("/enquiries/:id", deleteEnquiry);

router.get("/batch-enquiries", listBatchEnquiries);
router.delete("/batch-enquiries/:id", deleteBatchEnquiry);

export default router;
