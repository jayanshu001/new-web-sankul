import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3Mixed } from "../../middlewares/upload";
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
  getOrderById,
  updateOrderStatus,
  setOrderTracking,
  getSettings,
  updateSettings,
} from "./book.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

const bookUploadFields = uploadS3Mixed.fields([
  { name: "image", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
  { name: "demoUrl", maxCount: 1 },
]);

// Books CRUD
router.get("/", getBooks);
router.post("/", bookUploadFields, createBook);
router.post("/reorder", reorderBooks);
router.get("/settings", getSettings);
router.put("/settings", updateSettings);
router.get("/:id", getBookById);
router.put("/:id", bookUploadFields, updateBook);
router.delete("/:id", deleteBook);
router.patch("/:id/status", toggleBookStatus);
router.patch("/:id/trending", toggleBookTrending);

// Orders
router.get("/orders/list", getOrders);
router.get("/orders/:id", getOrderById);
router.patch("/orders/:id/status", updateOrderStatus);
router.patch("/orders/:id/tracking", setOrderTracking);

export default router;
