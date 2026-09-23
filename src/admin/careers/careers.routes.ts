import { Router } from "express";
import openingsRoutes from "./openings.routes";
import applicationsRoutes from "./applications.routes";

const router = Router();

router.use("/openings", openingsRoutes);
router.use("/applications", applicationsRoutes);

export default router;
