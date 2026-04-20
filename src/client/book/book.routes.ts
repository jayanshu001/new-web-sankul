import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listBooks,
  getBookDetail,
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  attachShipping,
  placeOrder,
  listMyOrders,
  getMyOrderById,
} from "./book.controller";

const router = Router();

// Catalogue (public-ish: no auth required to browse; cart decoration enabled if auth header present)
router.get("/", listBooks);

// Cart (auth required)
router.get("/cart", authenticate, getCart);
router.post("/cart", authenticate, addToCart);
router.put("/cart/:bookId", authenticate, updateCartItem);
router.delete("/cart/:bookId", authenticate, removeCartItem);
router.delete("/cart", authenticate, clearCart);

// Shipping
router.post("/shipping", authenticate, attachShipping);

// Orders
router.post("/order", authenticate, placeOrder);
router.get("/orders", authenticate, listMyOrders);
router.get("/orders/:id", authenticate, getMyOrderById);

// Book detail — must be last so it doesn't match /cart, /shipping, /order etc.
router.get("/:id", getBookDetail);

export default router;
