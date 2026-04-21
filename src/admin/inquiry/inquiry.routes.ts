import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listInquiries,
  getInquiry,
  deleteInquiry,
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "./inquiry.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Inquiries (read-only list + delete; submitted via client)
router.get("/inquiries", listInquiries);
router.get("/inquiries/:id", getInquiry);
router.delete("/inquiries/:id", deleteInquiry);

// Departments (contact-us master)
router.get("/departments", listDepartments);
router.post("/departments", createDepartment);
router.put("/departments/:id", updateDepartment);
router.delete("/departments/:id", deleteDepartment);

export default router;
