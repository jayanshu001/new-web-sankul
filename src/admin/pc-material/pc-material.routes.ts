// Admin PC materials: PC material master CRUD routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listPcMaterials,
  getPcMaterialById,
  createPcMaterial,
  updatePcMaterial,
  deletePcMaterial,
} from "./pc-material.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.get("/", listPcMaterials);
router.post("/", createPcMaterial);
router.get("/:id", getPcMaterialById);
router.put("/:id", updatePcMaterial);
router.delete("/:id", deletePcMaterial);

export default router;
