import { Request, Response } from "express";
import { z } from "zod";
import { Inquiry } from "../../models/system/Inquiry.model";
import { listActiveContactDepartments } from "../../modules/department/department.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const submitSchema = z.object({
  description: z.string().min(1).max(2000),
});

// POST /api/v1/client/inquiry
export const submitInquiry = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("submitInquiry invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("submitInquiry unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { description } = submitSchema.parse(req.body);
    const inquiry = await Inquiry.create({ customerId, description });
    logger.info("submitInquiry success", { traceId, customerId, inquiryId: inquiry._id });
    return res.status(201).json({
      success: true,
      message: "Your inquiry has been submitted. Our team will reach out to you shortly.",
      data: inquiry,
    });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("submitInquiry validation failed", { traceId, customerId, issues: e.issues });
      return res.status(400).json({
        success: false,
        message: "Please provide a valid description.",
        errors: e.issues,
      });
    }
    logger.error("submitInquiry failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({
      success: false,
      message: "Could not submit your inquiry. Please try again.",
    });
  }
};

// GET /api/v1/client/contactus — department contacts for support screen
export const getContactUs = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getContactUs invoked", { traceId, path: _req.originalUrl });

  try {
    const filtered = await listActiveContactDepartments();

    logger.info("getContactUs success", { traceId, count: filtered.length });
    return res.status(200).json({
      success: true,
      data: { departments: filtered },
    });
  } catch (e: any) {
    logger.error("getContactUs failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
