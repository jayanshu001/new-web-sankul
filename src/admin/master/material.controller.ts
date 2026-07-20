import { Request, Response } from "express";
import { createMaterialSchema, updateMaterialSchema } from "./master.validation";
import * as master from "../../modules/admin-master/admin-master.service";

export const getMaterials = async (req: Request, res: Response) => {
  try {
    const { data } = await master.pcmList();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createMaterial = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.isActive === "string") req.body.isActive = req.body.isActive === "true";
    const validatedData = createMaterialSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await master.pcmCreate(validatedData.title) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.isActive === "string") req.body.isActive = req.body.isActive === "true";
    const validatedData = updateMaterialSchema.parse(req.body);
    const numId = master.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Material ID" });
    const data = await master.pcmUpdate(numId, validatedData.title ?? "");
    if (!data) return res.status(404).json({ success: false, message: "Material not found" });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = master.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Material ID" });
    if (!(await master.pcmDelete(numId))) return res.status(404).json({ success: false, message: "Material not found" });
    return res.status(200).json({ success: true, message: "Material deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
