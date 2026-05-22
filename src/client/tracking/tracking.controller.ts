import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { ActivityLog } from "../../models/system/ActivityLog.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

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

    await ActivityLog.create({
      customerId,
      event: data.event,
      entityType: data.entityType ?? null,
      entityId: data.entityId && isObjectId(data.entityId) ? data.entityId : null,
      duration: data.duration ?? null,
      metadata: data.metadata ?? {},
      ip: (req.headers["x-forwarded-for"] as string) || req.ip,
      userAgent: req.headers["user-agent"] as string,
    });

    logger.info("trackEvent success", { traceId, customerId, event: data.event });
    return res.status(201).json({ success: true });
  } catch (e: any) {
    if (e.issues) { logger.warn("trackEvent validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("trackEvent failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
