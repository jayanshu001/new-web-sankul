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
} from "./receipts.controller";

const router = Router();

router.use(authenticate);

router.get("/subscriptions", listSubscriptionsHistory);
router.get("/books", listBooksHistory);
router.get("/ebooks", listEbooksHistory);

// Receipts — uniform JSON shape across all three purchase types.
router.get("/subscriptions/:id/receipt", getCourseReceipt);
router.get("/books/:id/receipt", getBookReceipt);
router.get("/ebooks/:id/receipt", getEbookReceipt);

export default router;
