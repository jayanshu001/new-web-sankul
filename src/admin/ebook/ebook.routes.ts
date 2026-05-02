import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3Mixed } from "../../middlewares/upload";
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

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Ebooks
router.get("/", getEbooks);
router.get("/reorder", reorderEbooks);
router.post("/reorder", reorderEbooks);
router.get("/:id", getEbookById);
const ebookUpload = uploadS3Mixed.fields([
  { name: "image", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
  { name: "demoUrl", maxCount: 1 },
  { name: "bookUrl", maxCount: 1 },
]);

router.post("/", ebookUpload, createEbook);
router.put("/:id", ebookUpload, updateEbook);
router.delete("/:id", deleteEbook);
router.patch("/:id/trending", toggleEbookTrending);

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
