import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listBooks,
  listTrendingBooks,
  listTrendingBooksOnly,
  listTrendingEbooksOnly,
  getBookDetail,
  listMyOrders,
  getMyOrderById,
  getMyOrderInvoice,
  getMyOrderTracking,
  getMyOrderTrackingLive,
} from "./book.controller";

const router = Router();

// Catalogue — auth required so we can decorate with cart + isPurchased.
router.get("/", authenticate, listBooks);
router.get("/trending", authenticate, listTrendingBooks);
router.get("/trending/books", authenticate, listTrendingBooksOnly);
router.get("/trending/ebooks", authenticate, listTrendingEbooksOnly);

// Cart endpoints have moved to /api/v1/client/cart (see src/client/cart/*)

// Shipping moved to POST /api/v1/client/cart/shipping (see src/client/cart/*)

// Orders (place-order moved to /api/v1/client/payment/create-order)
router.get("/orders", authenticate, listMyOrders);
router.get("/orders/:id/invoice", authenticate, getMyOrderInvoice);
router.get("/orders/:id/tracking/live", authenticate, getMyOrderTrackingLive);
router.get("/orders/:id/tracking", authenticate, getMyOrderTracking);
router.get("/orders/:id", authenticate, getMyOrderById);

// Book detail — must be last so it doesn't match /cart, /shipping, /order etc.
router.get("/:id", authenticate, getBookDetail);

export default router;
