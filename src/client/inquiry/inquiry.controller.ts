// Client inquiry: HTTP handlers for inquiries, contact-us and the public enquiry form.
import { Request, Response } from "express";
import { z } from "zod";
import { listActiveContactDepartments } from "../../modules/department/department.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { omit } from "../../utils/pick";
import { submitInquiry as sqlSubmitInquiry, submitPublicEnquiry } from "../../modules/inquiry/inquiry.service";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import type { PublicEnquiryInput } from "../../modules/inquiry/inquiry.validation";

const submitSchema = z.object({
  description: z.string().min(1).max(2000),
});

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
    const inquiry = await sqlSubmitInquiry(Number(customerId), description);
    logger.info("submitInquiry success", { traceId, customerId, inquiryId: (inquiry as any)._id });
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

export const getContactUs = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getContactUs invoked", { traceId, path: _req.originalUrl });

  try {
    const filtered = await listActiveContactDepartments();

    // The app reads department _id/name/description + contacts[].mobile only (call and
    // WhatsApp are always shown).
    const DROP = ["order", "active", "isCallAvailable", "isWhatsAppAvailable"];
    const departments = filtered.map((d: any) => ({
      ...omit(d, DROP),
      ...(Array.isArray(d.contacts) ? { contacts: d.contacts.map((c: any) => omit(c, DROP)) } : {}),
    }));
    logger.info("getContactUs success", { traceId, count: filtered.length });
    return res.status(200).json({
      success: true,
      data: { departments },
    });
  } catch (e: any) {
    logger.error("getContactUs failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Public marketing-site lead form; no account required.
export const submitEnquiry = asyncHandler(async (req: Request, res: Response) => {
  const enquiry = await submitPublicEnquiry(req.body as PublicEnquiryInput);
  return success(res, { enquiry }, "Thanks! Our team will contact you shortly.", 201);
});
