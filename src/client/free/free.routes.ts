import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listFreeTests,
  listFreeMaterials,
  listFreeVideos,
  listFreeEbooks,
  listFreeCourses,
} from "./free.controller";

const router = Router();

router.use(authenticate);

router.get("/free-tests", listFreeTests);
router.get("/free-materials", listFreeMaterials);
router.get("/free-videos", listFreeVideos);
router.get("/free-ebooks", listFreeEbooks);
router.get("/free-courses", listFreeCourses);

export default router;
