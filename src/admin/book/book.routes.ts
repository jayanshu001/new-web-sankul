import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getBooks,
  getBookById,
  createBook,
  updateBook,
  deleteBook,
  toggleBookStatus,
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

// Books CRUD
router.get("/", getBooks);
router.post("/", createBook);
router.post("/reorder", reorderBooks);
router.get("/settings", getSettings);
router.put("/settings", updateSettings);
router.get("/:id", getBookById);
router.put("/:id", updateBook);
router.delete("/:id", deleteBook);
router.patch("/:id/status", toggleBookStatus);

// Orders
router.get("/orders/list", getOrders);
router.get("/orders/:id", getOrderById);
router.patch("/orders/:id/status", updateOrderStatus);
router.patch("/orders/:id/tracking", setOrderTracking);

export default router;
