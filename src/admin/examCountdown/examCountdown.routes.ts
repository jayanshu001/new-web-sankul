import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  adminListCategories,
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
  adminListCountdowns,
  adminCreateCountdown,
  adminUpdateCountdown,
  adminDeleteCountdown,
} from "./examCountdown.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Categories
router.get("/categories", adminListCategories);
router.post("/categories", adminCreateCategory);
router.put("/categories/:id", adminUpdateCategory);
router.delete("/categories/:id", adminDeleteCategory);

// Countdowns
router.get("/", adminListCountdowns);
router.post("/", adminCreateCountdown);
router.put("/:id", adminUpdateCountdown);
router.delete("/:id", adminDeleteCountdown);

export default router;
