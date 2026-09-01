import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  listTestSeries,
  getTestSeriesById,
  createTestSeries,
  updateTestSeries,
  deleteTestSeries,
  listContentCategories,
  createContentCategory,
  updateContentCategory,
  deleteContentCategory,
  listPapers,
  linkPaper,
  updatePaperLink,
  unlinkPaper,
  listPrices,
  createPrice,
  updatePrice,
  deletePrice,
  listSubscriptions,
  exportSubscriptionsCsv,
  exportSubscriptionsExcel,
  grantSubscription,
  getSubscription,
  updateSubscription,
  deleteSubscription,
  listOrders,
} from "./testSeries.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// --- Literal-prefix routes first so they don't collide with /:id patterns ----
router.put("/content-categories/:categoryId",       autoFlushGroup("test-series"), uploadS3.single("icon"), updateContentCategory);
router.delete("/content-categories/:categoryId",    autoFlushGroup("test-series"), deleteContentCategory);

router.put("/papers/:linkId",                       autoFlushGroup("test-series"), updatePaperLink);
router.delete("/papers/:linkId",                    autoFlushGroup("test-series"), unlinkPaper);

router.put("/prices/:priceId",                      autoFlushGroup("test-series"), updatePrice);
router.delete("/prices/:priceId",                   autoFlushGroup("test-series"), deletePrice);

// Subscription writes deliberately carry NO autoFlushGroup: they change one
// CUSTOMER's entitlement (isPurchased / activeSubscription), not the shared
// catalog, so the controllers call flushUserRouteCache(customerId) instead —
// an entity-wide sweep would cold-start every user's cache for a single grant.
router.get("/subscriptions",                        listSubscriptions);
// Export routes before `/subscriptions/:subscriptionId` so they aren't matched as an id.
router.get("/subscriptions/export/csv",             exportSubscriptionsCsv);
router.get("/subscriptions/export/excel",           exportSubscriptionsExcel);
router.get("/subscriptions/:subscriptionId",        getSubscription);
router.put("/subscriptions/:subscriptionId",        updateSubscription);
router.delete("/subscriptions/:subscriptionId",     deleteSubscription);

router.get("/orders",                               listOrders);

// --- Test Series CRUD -------------------------------------------------------
router.get("/",                                     listTestSeries);
router.post("/",                                    autoFlushGroup("test-series"), uploadS3.single("thumbnail"), createTestSeries);
router.get("/:id",                                  getTestSeriesById);
router.put("/:id",                                  autoFlushGroup("test-series"), uploadS3.single("thumbnail"), updateTestSeries);
router.delete("/:id",                               autoFlushGroup("test-series"), deleteTestSeries);

// --- Nested under a series --------------------------------------------------
router.get("/:id/content-categories",               listContentCategories);
router.post("/:id/content-categories",              autoFlushGroup("test-series"), uploadS3.single("icon"), createContentCategory);

router.get("/:id/papers",                           listPapers);
router.post("/:id/papers",                          autoFlushGroup("test-series"), linkPaper);

router.get("/:id/prices",                           listPrices);
router.post("/:id/prices",                          autoFlushGroup("test-series"), createPrice);

router.post("/:id/grant",                           grantSubscription);

export default router;
