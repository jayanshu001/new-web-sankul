import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3Mixed, enforceMixedSizeLimits } from "../../middlewares/upload";
import {
  getEbooks,
  getEbookById,
  createEbook,
  updateEbook,
  deleteEbook,
  reorderEbooks,
  toggleEbookTrending,
  getEbookPlans,
  getEbookPromocodes,
  createEbookPlan,
  getEbookPlanById,
  updateEbookPlan,
  deleteEbookPlan,
} from "./ebook.controller";
import {
  getEbookSubscriptions,
  getEbookSubscriptionById,
  createEbookSubscription,
  updateEbookSubscription,
  deleteEbookSubscription,
  getEbookPricesForSubscription,
  exportEbookSubscriptionsCsv,
  exportEbookSubscriptionsExcel,
} from "./ebook-subscription.controller";
import {
  uploadEbookPdf,
  getPdfUploadBatch,
} from "../pdfUpload/pdfUpload.controller";
import { uploadSinglePdfToDisk } from "../pdfUpload/pdfUpload.multer";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Ebooks
// Route-level response cache. Reads tagged entity: CacheEntity.Ebook; writes below call
// autoFlushGroup(CacheEntity.Ebook) so edits clear these instantly. See cache/ROUTE_CACHE.md.
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Ebook }), getEbooks);
router.get("/reorder", reorderEbooks);
router.post("/reorder", autoFlushGroup(CacheEntity.Ebook), reorderEbooks);
// PDF-upload status snapshot — must precede `/:id` so it isn't matched as an id.
router.get("/pdf-jobs/:batchId", getPdfUploadBatch);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Ebook }), getEbookById);
const ebookUpload = uploadS3Mixed.fields([
  { name: "image", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
  { name: "demoUrl", maxCount: 1 },
  { name: "bookUrl", maxCount: 1 },
]);

router.post("/", ebookUpload, enforceMixedSizeLimits, autoFlushGroup(CacheEntity.Ebook), createEbook);
router.put("/:id", ebookUpload, enforceMixedSizeLimits, autoFlushGroup(CacheEntity.Ebook), updateEbook);
router.delete("/:id", autoFlushGroup(CacheEntity.Ebook), deleteEbook);
router.patch("/:id/trending", autoFlushGroup(CacheEntity.Ebook), toggleEbookTrending);

// Async PDF upload (Book/Demo) via the BullMQ queue + live Socket progress.
// Alternative to the synchronous bookUrl/demoUrl fields on PUT /:id — use this
// for large PDFs so the admin gets an in_progress → completed progress bar.
// multipart: file (one PDF) + optional target ("bookUrl" default | "demoUrl").
// Status snapshot is GET /pdf-jobs/:batchId (registered above).
router.post("/:ebookId/pdf", uploadSinglePdfToDisk, uploadEbookPdf);

// Pricing Plans — flush CacheEntity.Plan (was unflushed: plans/prices are
// embedded in every cached ebook detail/list, both the admin cache.aside
// layer and the client-facing CatalogEbook cache.aside added this session —
// see flushGroups.ts's "plan" group, which already covers both).
router.get("/:id/plans", getEbookPlans);
router.post("/:id/plans", autoFlushGroup(CacheEntity.Plan), createEbookPlan);

// Promocodes applicable to this ebook (paginated).
router.get("/:id/promocodes", getEbookPromocodes);
router.get("/plans/:planId", getEbookPlanById);
router.put("/plans/:planId", autoFlushGroup(CacheEntity.Plan), updateEbookPlan);
router.delete("/plans/:planId", autoFlushGroup(CacheEntity.Plan), deleteEbookPlan);

// Subscriptions
router.get("/subscriptions/list", getEbookSubscriptions);
// Report exports — full filtered set, no pagination. Static paths registered
// before `/subscriptions/:subscriptionId` so they aren't matched as an id.
router.get("/subscriptions/export/csv", exportEbookSubscriptionsCsv);
router.get("/subscriptions/export/excel", exportEbookSubscriptionsExcel);
router.post("/subscriptions", createEbookSubscription);
router.get("/subscriptions/:subscriptionId", getEbookSubscriptionById);
router.put("/subscriptions/:subscriptionId", updateEbookSubscription);
router.delete("/subscriptions/:subscriptionId", deleteEbookSubscription);

// Get ebook prices for subscription creation
router.get("/:ebookId/prices", getEbookPricesForSubscription);

export default router;
