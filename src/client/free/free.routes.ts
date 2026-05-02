import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { listFreeTests, listFreeMaterials, listFreeVideos } from "./free.controller";

const router = Router();

router.use(authenticate);

router.get("/free-tests", listFreeTests);
router.get("/free-materials", listFreeMaterials);
router.get("/free-videos", listFreeVideos);

export default router;
