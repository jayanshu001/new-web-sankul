import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listTestSeries,
  getTestSeriesDetail,
  listSeriesPapers,
  previewCheckout,
  listMySubscriptions,
} from "./testSeries.controller";

const router = Router();

router.use(authenticate);

router.get("/my/subscriptions",       listMySubscriptions);
router.post("/checkout/preview",      previewCheckout);

router.get("/",                       listTestSeries);
router.get("/:id",                    getTestSeriesDetail);
router.get("/:id/papers",             listSeriesPapers);

export default router;
