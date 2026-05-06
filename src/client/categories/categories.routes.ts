import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listVideosByCategory,
  listMaterialsByCategory,
  listExamsByCategory,
  listPackagesByExamCountdownCategory,
  listBooksAndEbooksByExamCountdownCategory,
} from "./categories.controller";

const router = Router();

router.use(authenticate);

router.get("/video-categories/:id/videos", listVideosByCategory);
router.get("/material-categories/:id/materials", listMaterialsByCategory);
router.get("/exam-categories/:id/exams", listExamsByCategory);
router.get("/exam-countdown-categories/:id/packages", listPackagesByExamCountdownCategory);
router.get("/exam-countdown-categories/:id/books-ebooks", listBooksAndEbooksByExamCountdownCategory);

export default router;
