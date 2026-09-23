import { Router } from "express";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";
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

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Inquiries (read-only list + delete; submitted via client)
router.get("/inquiries", listInquiries);
router.get("/inquiries/:id", getInquiry);
router.delete("/inquiries/:id", deleteInquiry);

// Departments (contact-us master)
router.get("/departments", listDepartments);
router.post("/departments", autoFlushGroup(CacheEntity.ContactDepartment), createDepartment);
router.put("/departments/:id", autoFlushGroup(CacheEntity.ContactDepartment), updateDepartment);
router.delete("/departments/:id", autoFlushGroup(CacheEntity.ContactDepartment), deleteDepartment);

export default router;
