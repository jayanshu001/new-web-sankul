import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  placeCourseOrder,
  placeEbookOrder,
  verifyPayment,
  listMyOrders,
} from "./orders.controller";

const router = Router();

router.use(authenticate);

router.get("/", listMyOrders);
router.post("/course", placeCourseOrder);
router.post("/ebook", placeEbookOrder);
router.post("/verify-payment", verifyPayment);

export default router;
