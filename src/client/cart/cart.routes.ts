import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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

// Cart is per-user (it's *my* cart) → scope: CacheScope.User, short 30s TTL. Writes below
// autoFlush(CacheEntity.Cart) so an add/remove/update shows immediately, not after TTL.
router.post("/", autoFlush(CacheEntity.Cart), addToCart);
router.get("/", cacheRoute({ ttl: CACHE_TTL.QUICK_REFRESH, entity: CacheEntity.Cart, scope: CacheScope.User }), getCart);
router.patch("/items/:bookId", autoFlush(CacheEntity.Cart), updateCartItemQty);
router.delete("/items/:bookId", autoFlush(CacheEntity.Cart), removeCartItem);
router.post("/shipping", autoFlush(CacheEntity.Cart), attachShippingToCart);

export default router;
