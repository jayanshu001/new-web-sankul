import { Router } from "express";
import contentRoutes from "./content.routes";
import organizationsRoutes from "./organizations.routes";
import papersRoutes from "./papers.routes";
import suggestedProductsRoutes from "./suggested-products.routes";

const router = Router();

router.use("/content", contentRoutes);
router.use("/organizations", organizationsRoutes);
router.use("/papers", papersRoutes);
router.use("/suggested-products", suggestedProductsRoutes);

export default router;
