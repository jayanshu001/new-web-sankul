import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listEbooks,
  listMySubscriptions,
  getEbookDetail,
  getEbookOrderInvoice,
} from "./ebook.controller";

const router = Router();

router.use(authenticate);

router.get("/", listEbooks);
router.get("/subscriptions", listMySubscriptions);
router.get("/orders/:orderId/invoice", getEbookOrderInvoice);
router.get("/:id", getEbookDetail);

export default router;
