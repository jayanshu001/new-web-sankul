import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listVideosByCategory,
  listMaterialsByCategory,
  listExamsByCategory,
  listVideoCategoryChildren,
  listMaterialCategoryChildren,
  listExamCategoryChildren,
  listPackagesByExamCountdownCategory,
  listBooksAndEbooksByExamCountdownCategory,
  listPackageCategories,
  listPackagesByCategory,
  listLiveCourseCategories,
  listLiveCoursesByCategory,
} from "./categories.controller";

const router = Router();

router.use(authenticate);

router.get("/video-categories/:id/videos", listVideosByCategory);
router.get("/video-categories/:id/children", listVideoCategoryChildren);
router.get("/material-categories/:id/materials", listMaterialsByCategory);
router.get("/material-categories/:id/children", listMaterialCategoryChildren);
router.get("/exam-categories/:id/exams", listExamsByCategory);
router.get("/exam-categories/:id/children", listExamCategoryChildren);
router.get("/exam-countdown-categories/:id/packages", listPackagesByExamCountdownCategory);
router.get("/exam-countdown-categories/:id/books-ebooks", listBooksAndEbooksByExamCountdownCategory);
router.get("/package-categories", listPackageCategories);
router.get("/package-categories/:id/packages", listPackagesByCategory);
router.get("/live-course-categories", listLiveCourseCategories);
router.get("/live-course-categories/:id/live-courses", listLiveCoursesByCategory);

export default router;
