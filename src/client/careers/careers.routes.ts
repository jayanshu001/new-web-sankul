import { Router } from "express";
import { validate } from "../../middlewares/validate";
import { applicationCreateSchema } from "../../modules/careers/careers.validation";
import { getCurrentOpenings, applyToOpening } from "./careers.controller";

const router = Router();

router.get("/current-openings", getCurrentOpenings);
router.post("/apply", validate({ body: applicationCreateSchema }), applyToOpening);

export default router;
