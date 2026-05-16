import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listVideosByCategory,
  listMaterialsByCategory,
  listExamsByCategory,
  listPackagesByExamCountdownCategory,
  listBooksAndEbooksByExamCountdownCategory,
  listPackageCategories,
  listCategoriesByPackage,
} from "./categories.controller";

const router = Router();

router.use(authenticate);

router.get("/video-categories/:id/videos", listVideosByCategory);
router.get("/material-categories/:id/materials", listMaterialsByCategory);
router.get("/exam-categories/:id/exams", listExamsByCategory);
router.get("/exam-countdown-categories/:id/packages", listPackagesByExamCountdownCategory);
router.get("/exam-countdown-categories/:id/books-ebooks", listBooksAndEbooksByExamCountdownCategory);
router.get("/package-categories", listPackageCategories);
router.get("/packages/:id/categories", listCategoriesByPackage);

export default router;
