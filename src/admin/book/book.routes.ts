import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3Mixed, enforceMixedSizeLimits } from "../../middlewares/upload";
import { autoFlushGroup, autoFlush } from "../../middlewares/autoFlush";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  getBooks,
  getBookById,
  createBook,
  updateBook,
  deleteBook,
  toggleBookStatus,
  toggleBookTrending,
  reorderBooks,
  getOrders,
  exportOrdersCsv,
  exportOrdersExcel,
  getOrderById,
  updateOrderStatus,
  setOrderTracking,
  addOrderTrackingEvent,
  getSettings,
  updateSettings,
} from "./book.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

const bookUploadFields = uploadS3Mixed.fields([
  { name: "image", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
  { name: "demoUrl", maxCount: 1 },
]);

// Books CRUD
// Writes call autoFlushGroup("book") so an edit (incl. price columns) instantly
// clears every cached read that embeds book data — book/catalog-book/dashboard/
// exam-countdown AND the client cart (see flushGroups.ts). Otherwise a price
// change would only surface after the cached read's TTL lapses.
router.get("/", cacheRoute({ ttl: 86400, entity: "book" }), getBooks);
router.post("/", bookUploadFields, enforceMixedSizeLimits, autoFlushGroup("book"), createBook);
router.post("/reorder", autoFlushGroup("book"), reorderBooks);
router.get("/settings", getSettings);
// Settings drives the free-shipping threshold used by the cart total → flush cart.
router.put("/settings", autoFlush("cart"), updateSettings);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "book" }), getBookById);
router.put("/:id", bookUploadFields, enforceMixedSizeLimits, autoFlushGroup("book"), updateBook);
router.delete("/:id", autoFlushGroup("book"), deleteBook);
router.patch("/:id/status", autoFlushGroup("book"), toggleBookStatus);
router.patch("/:id/trending", autoFlushGroup("book"), toggleBookTrending);

// Orders
router.get("/orders/list", getOrders);
// Export routes registered BEFORE the `/orders/:id` param route so "export" is
// never captured as an :id.
router.get("/orders/export/csv", exportOrdersCsv);
router.get("/orders/export/excel", exportOrdersExcel);
router.get("/orders/:id", getOrderById);
router.patch("/orders/:id/status", updateOrderStatus);
router.patch("/orders/:id/tracking", setOrderTracking);
router.post("/orders/:id/tracking/events", addOrderTrackingEvent);

export default router;
