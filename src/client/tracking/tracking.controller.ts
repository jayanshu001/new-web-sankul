import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parseTrackingId,
  createActivity,
} from "../../modules/tracking/tracking.service";

const trackSchema = z.object({
  event: z.string().min(1).max(100),
  entityType: z.string().max(50).optional(),
  entityId: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
  metadata: z.record(z.any()).optional(),
});

// POST /api/v1/client/tracking
export const trackEvent = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id || null;
  logger.info("trackEvent invoked", { traceId, path: req.originalUrl, customerId, event: req.body?.event });

  try {
    const data = trackSchema.parse(req.body);

    // ─── SQL branch (int id-space) — gated on `tracking` (flag already ON) ───
    const cidNum = customerId ? parseTrackingId(String(customerId)) : null;
    const entId = data.entityId ? parseTrackingId(String(data.entityId)) : null;
    await createActivity({
      customerId: cidNum,
      event: data.event,
      entityType: data.entityType ?? null,
      entityId: entId,
      duration: data.duration ?? null,
      metadata: data.metadata ?? {},
      ip: (req.headers["x-forwarded-for"] as string) || req.ip || null,
      userAgent: (req.headers["user-agent"] as string) || null,
    });
    logger.info("trackEvent success (sql)", { traceId, customerId, event: data.event });
    return res.status(201).json({ success: true });
  } catch (e: any) {
    if (e.issues) { logger.warn("trackEvent validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("trackEvent failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
