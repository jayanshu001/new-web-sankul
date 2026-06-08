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
} from "./ebook-subscription.controller";
import {
  uploadEbookPdf,
  getPdfUploadBatch,
} from "../pdfUpload/pdfUpload.controller";
import { uploadSinglePdfToDisk } from "../pdfUpload/pdfUpload.multer";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Ebooks
router.get("/", getEbooks);
router.get("/reorder", reorderEbooks);
router.post("/reorder", reorderEbooks);
// PDF-upload status snapshot — must precede `/:id` so it isn't matched as an id.
router.get("/pdf-jobs/:batchId", getPdfUploadBatch);
router.get("/:id", getEbookById);
const ebookUpload = uploadS3Mixed.fields([
  { name: "image", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
  { name: "demoUrl", maxCount: 1 },
  { name: "bookUrl", maxCount: 1 },
]);

router.post("/", ebookUpload, enforceMixedSizeLimits, createEbook);
router.put("/:id", ebookUpload, enforceMixedSizeLimits, updateEbook);
router.delete("/:id", deleteEbook);
router.patch("/:id/trending", toggleEbookTrending);

// Async PDF upload (Book/Demo) via the BullMQ queue + live Socket progress.
// Alternative to the synchronous bookUrl/demoUrl fields on PUT /:id — use this
// for large PDFs so the admin gets an in_progress → completed progress bar.
// multipart: file (one PDF) + optional target ("bookUrl" default | "demoUrl").
// Status snapshot is GET /pdf-jobs/:batchId (registered above).
router.post("/:ebookId/pdf", uploadSinglePdfToDisk, uploadEbookPdf);

// Pricing Plans
router.get("/:id/plans", getEbookPlans);
router.post("/:id/plans", createEbookPlan);
router.get("/plans/:planId", getEbookPlanById);
router.put("/plans/:planId", updateEbookPlan);
router.delete("/plans/:planId", deleteEbookPlan);

// Subscriptions
router.get("/subscriptions/list", getEbookSubscriptions);
router.post("/subscriptions", createEbookSubscription);
router.get("/subscriptions/:subscriptionId", getEbookSubscriptionById);
router.put("/subscriptions/:subscriptionId", updateEbookSubscription);
router.delete("/subscriptions/:subscriptionId", deleteEbookSubscription);

// Get ebook prices for subscription creation
router.get("/:ebookId/prices", getEbookPricesForSubscription);

export default router;
