import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { globalSearch } from "./search.controller";

const router = Router();

router.get("/", authenticate, globalSearch);

export default router;
