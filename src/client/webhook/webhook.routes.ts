import { Router } from "express";
import { paymentWebhook } from "./webhook.controller";

const router = Router();

// Public — razorpay calls this. Signature verified via header.
router.post("/payment", paymentWebhook);

export default router;
