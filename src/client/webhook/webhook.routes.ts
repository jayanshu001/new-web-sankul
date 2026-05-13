import { Router } from "express";
import { paymentWebhook } from "./webhook.controller";
import { recordingWebhook } from "../../admin/live/live.controller";

const router = Router();

// Public — razorpay calls this. Signature verified via header.
router.post("/payment", paymentWebhook);

// Public — Streamos calls this when recordings are ready.
router.post("/recording", recordingWebhook);

export default router;
