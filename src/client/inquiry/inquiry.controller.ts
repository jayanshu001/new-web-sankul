import { Request, Response } from "express";
import { z } from "zod";
import { Inquiry } from "../../models/system/Inquiry.model";
import { Department } from "../../models/system/Department.model";
import { InquiryCourse, InquiryMode } from "../../models/enums";

const submitSchema = z.object({
  name: z.string().min(1).max(255),
  mobile: z.string().min(6).max(20),
  email: z.string().email().max(255),
  city: z.string().min(1).max(100),
  course: z.enum(Object.values(InquiryCourse) as [string, ...string[]]),
  mode: z.enum(Object.values(InquiryMode) as [string, ...string[]]),
  message: z.string().max(2000).optional(),
  source: z.string().max(50).optional(),
});

// POST /api/v1/client/inquiry
export const submitInquiry = async (req: Request, res: Response) => {
  try {
    const data = submitSchema.parse(req.body);
    const inquiry = await Inquiry.create(data);
    return res.status(201).json({ success: true, data: inquiry });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/contactus — department contacts for support screen
export const getContactUs = async (_req: Request, res: Response) => {
  try {
    const departments = await Department.find({ active: true })
      .sort({ order: 1 })
      .lean();

    // Filter contacts to active ones, preserve order
    const filtered = departments.map((d: any) => ({
      ...d,
      contacts: (d.contacts || [])
        .filter((c: any) => c.active)
        .sort((a: any, b: any) => a.order - b.order),
    }));

    return res.status(200).json({
      success: true,
      data: {
        departments: filtered,
        timing: "Monday - Saturday : 09 AM - 06 PM",
        note: "રવિવારે તથા જાહેર રજાના દિવસે રજા રહેશે.",
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
