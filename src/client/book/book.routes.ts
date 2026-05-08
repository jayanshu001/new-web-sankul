import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listBooks,
  listTrendingBooks,
  getBookDetail,
  listMyOrders,
  getMyOrderById,
} from "./book.controller";

const router = Router();

// Catalogue (public-ish: no auth required to browse; cart decoration enabled if auth header present)
router.get("/", listBooks);
router.get("/trending", authenticate, listTrendingBooks);

// Cart endpoints have moved to /api/v1/client/cart (see src/client/cart/*)

// Shipping moved to POST /api/v1/client/cart/shipping (see src/client/cart/*)

// Orders (place-order moved to /api/v1/client/payment/create-order)
router.get("/orders", authenticate, listMyOrders);
router.get("/orders/:id", authenticate, getMyOrderById);

// Book detail — must be last so it doesn't match /cart, /shipping, /order etc.
router.get("/:id", getBookDetail);

export default router;
