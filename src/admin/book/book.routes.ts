// Admin books: catalog CRUD, order report/export, tracking and store settings routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3Mixed, enforceMixedSizeLimits, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import { autoFlushGroup, autoFlush } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CACHE_TTL } from "../../config/cacheTtl";
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

const bookUploadFields = [
  uploadTo({ image: UPLOAD_FOLDERS.bookImages, thumbnail: UPLOAD_FOLDERS.bookThumbnail, demoUrl: UPLOAD_FOLDERS.bookDemo }),
  uploadS3Mixed.fields([
    { name: "image", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
    { name: "demoUrl", maxCount: 1 },
  ]),
];

// Writes flush CacheEntity.Book so an edit (incl. price) instantly clears every
// cached read embedding book data: book/catalog-book/dashboard/exam-countdown and
// the client cart (see flushGroups.ts).
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Book }), getBooks);
router.post("/", bookUploadFields, enforceMixedSizeLimits, autoFlushGroup(CacheEntity.Book), createBook);
router.post("/reorder", autoFlushGroup(CacheEntity.Book), reorderBooks);
router.get("/settings", getSettings);
// Settings drives the free-shipping threshold used by the cart total → flush cart.
router.put("/settings", autoFlush(CacheEntity.Cart), updateSettings);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Book }), getBookById);
router.put("/:id", bookUploadFields, enforceMixedSizeLimits, autoFlushGroup(CacheEntity.Book), updateBook);
router.delete("/:id", autoFlushGroup(CacheEntity.Book), deleteBook);
router.patch("/:id/status", autoFlushGroup(CacheEntity.Book), toggleBookStatus);
router.patch("/:id/trending", autoFlushGroup(CacheEntity.Book), toggleBookTrending);

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
