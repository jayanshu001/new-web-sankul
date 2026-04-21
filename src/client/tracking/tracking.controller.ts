import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { ActivityLog } from "../../models/system/ActivityLog.model";

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
  try {
    const customerId = req.user?.id || null;
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

    return res.status(201).json({ success: true });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};
