import { Request, Response } from "express";
import { z } from "zod";
import { Inquiry } from "../../models/system/Inquiry.model";
import { Department } from "../../models/system/Department.model";

const submitSchema = z.object({
  description: z.string().min(1).max(2000),
});

// POST /api/v1/client/inquiry
export const submitInquiry = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { description } = submitSchema.parse(req.body);
    const inquiry = await Inquiry.create({ customerId, description });
    return res.status(201).json({
      success: true,
      message: "Your inquiry has been submitted. Our team will reach out to you shortly.",
      data: inquiry,
    });
  } catch (e: any) {
    if (e.issues) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid description.",
        errors: e.issues,
      });
    }
    return res.status(500).json({
      success: false,
      message: "Could not submit your inquiry. Please try again.",
    });
  }
};

// GET /api/v1/client/contactus — department contacts for support screen
export const getContactUs = async (_req: Request, res: Response) => {
  try {
    const departments = await Department.find({ active: true })
      .sort({ order: 1 })
      .lean();

    const filtered = departments.map((d: any) => ({
      ...d,
      contacts: (d.contacts || [])
        .filter((c: any) => c.active)
        .sort((a: any, b: any) => a.order - b.order),
    }));

    return res.status(200).json({
      success: true,
      data: { departments: filtered },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
