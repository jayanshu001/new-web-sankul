// Client webhooks: Razorpay payment and StreamOS recording routes.
import { Router } from "express";
import { paymentWebhook } from "./webhook.controller";
import { recordingWebhook } from "../../admin/live/streamos.webhook.controller";

const router = Router();

// Public: Razorpay calls this; authenticated by the signature header.
router.post("/payment", paymentWebhook);

// Public: StreamOS calls this when recordings are ready.
router.post("/recording", recordingWebhook);

export default router;
