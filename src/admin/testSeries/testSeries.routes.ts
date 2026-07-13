import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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
router.put("/content-categories/:categoryId",       uploadS3.single("icon"), updateContentCategory);
router.delete("/content-categories/:categoryId",    deleteContentCategory);

router.put("/papers/:linkId",                       updatePaperLink);
router.delete("/papers/:linkId",                    unlinkPaper);

router.put("/prices/:priceId",                      updatePrice);
router.delete("/prices/:priceId",                   deletePrice);

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
router.post("/",                                    uploadS3.single("thumbnail"), createTestSeries);
router.get("/:id",                                  getTestSeriesById);
router.put("/:id",                                  uploadS3.single("thumbnail"), updateTestSeries);
router.delete("/:id",                               deleteTestSeries);

// --- Nested under a series --------------------------------------------------
router.get("/:id/content-categories",               listContentCategories);
router.post("/:id/content-categories",              uploadS3.single("icon"), createContentCategory);

router.get("/:id/papers",                           listPapers);
router.post("/:id/papers",                          linkPaper);

router.get("/:id/prices",                           listPrices);
router.post("/:id/prices",                          createPrice);

router.post("/:id/grant",                           grantSubscription);

export default router;
