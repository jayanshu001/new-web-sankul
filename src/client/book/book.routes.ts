// Client books: catalog, trending lists and book order routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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

// listBooks / getBookDetail cache internally (shared data cached; cart qty/isPurchased/
// demoMediaToken always live). Don't wrap them in cacheRoute({ scope: CacheScope.User });
// see course.routes.ts for why.
router.get("/", authenticate, listBooks);
// Trending lists carry no per-user state, so they are shared-cached.
const TRENDING = { ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogBook as const, scope: CacheScope.Shared as const };
router.get("/trending", authenticate, cacheRoute(TRENDING), listTrendingBooks);
router.get("/trending/books", authenticate, cacheRoute(TRENDING), listTrendingBooksOnly);
router.get("/trending/ebooks", authenticate, cacheRoute(TRENDING), listTrendingEbooksOnly);

router.get("/orders", authenticate, listMyOrders);
router.get("/orders/:id/invoice", authenticate, getMyOrderInvoice);
router.get("/orders/:id/tracking/live", authenticate, getMyOrderTrackingLive);
router.get("/orders/:id/tracking", authenticate, getMyOrderTracking);
router.get("/orders/:id", authenticate, getMyOrderById);

// Must be last so it doesn't capture the static paths above.
router.get("/:id", authenticate, getBookDetail);

export default router;
