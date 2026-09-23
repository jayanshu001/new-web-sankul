import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listSubscriptionsHistory,
  listBooksHistory,
  listEbooksHistory,
} from "./purchase-history.controller";
import {
  getBookReceipt,
  getCourseReceipt,
  getEbookReceipt,
  getSubscriptionTracking,
  getSubscriptionTrackingLive,
} from "./receipts.controller";

const router = Router();

router.use(authenticate);

router.get("/subscriptions", listSubscriptionsHistory);
router.get("/books", listBooksHistory);
router.get("/ebooks", listEbooksHistory);

// Subscription material shipment tracking (with-material package/course + live).
// /tracking/live registered BEFORE /tracking so the more specific path wins.
router.get("/subscriptions/:id/tracking/live", getSubscriptionTrackingLive);
router.get("/subscriptions/:id/tracking", getSubscriptionTracking);

// Receipts — uniform JSON shape across all three purchase types.
router.get("/subscriptions/:id/receipt", getCourseReceipt);
router.get("/books/:id/receipt", getBookReceipt);
router.get("/ebooks/:id/receipt", getEbookReceipt);

export default router;
