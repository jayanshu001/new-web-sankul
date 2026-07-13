import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlush } from "../../middlewares/autoFlush";
import {
  addToCart,
  getCart,
  updateCartItemQty,
  removeCartItem,
  attachShippingToCart,
} from "./cart.controller";

const router = Router();

router.use(authenticate);

// Cart is per-user (it's *my* cart) → scope:"user", short 30s TTL. Writes below
// autoFlush("cart") so an add/remove/update shows immediately, not after TTL.
router.post("/", autoFlush("cart"), addToCart);
router.get("/", cacheRoute({ ttl: 30, entity: "cart", scope: "user" }), getCart);
router.patch("/items/:bookId", autoFlush("cart"), updateCartItemQty);
router.delete("/items/:bookId", autoFlush("cart"), removeCartItem);
router.post("/shipping", autoFlush("cart"), attachShippingToCart);

export default router;
