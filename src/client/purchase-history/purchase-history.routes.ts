import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listSubscriptionsHistory,
  listBooksHistory,
  listEbooksHistory,
} from "./purchase-history.controller";

const router = Router();

router.use(authenticate);

router.get("/subscriptions", listSubscriptionsHistory);
router.get("/books", listBooksHistory);
router.get("/ebooks", listEbooksHistory);

export default router;
