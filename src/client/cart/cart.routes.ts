// Client cart: book cart and shipping address routes.
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

// Cart reads are cached per user; every write autoFlushes CacheEntity.Cart so changes show immediately.
router.post("/", autoFlush(CacheEntity.Cart), addToCart);
router.get("/", cacheRoute({ ttl: CACHE_TTL.QUICK_REFRESH, entity: CacheEntity.Cart, scope: CacheScope.User }), getCart);
router.patch("/items/:bookId", autoFlush(CacheEntity.Cart), updateCartItemQty);
router.delete("/items/:bookId", autoFlush(CacheEntity.Cart), removeCartItem);
router.post("/shipping", autoFlush(CacheEntity.Cart), attachShippingToCart);

export default router;
