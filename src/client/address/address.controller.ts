import { Request, Response } from "express";
import mongoose from "mongoose";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { CustomerDistrict } from "../../models/customer/CustomerDistrict.model";
import { CustomerEducation } from "../../models/customer/CustomerEducation.model";
import { Goal } from "../../models/Goal.model";
import { createAddressSchema, updateAddressSchema } from "./address.validation";

// ─── Addresses ────────────────────────────────────────────────────────────────

export const getMyAddresses = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const addresses = await CustomerAddress.find({ customerId, status: true })
      .populate("stateId", "_id name stateCode")
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: addresses });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAddressById = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Address ID" });

    const address = await CustomerAddress.findOne({ _id: id, customerId })
      .populate("stateId", "_id name stateCode");
    if (!address) return res.status(404).json({ success: false, message: "Address not found" });
    return res.status(200).json({ success: true, data: address });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createAddress = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const data = createAddressSchema.parse(req.body);
    const address = new CustomerAddress({ ...data, customerId });
    await address.save();
    return res.status(201).json({ success: true, data: address });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAddress = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Address ID" });

    const data = updateAddressSchema.parse(req.body);
    const address = await CustomerAddress.findOneAndUpdate(
      { _id: id, customerId },
      { $set: data },
      { new: true }
    ).populate("stateId", "_id name stateCode");

    if (!address) return res.status(404).json({ success: false, message: "Address not found" });
    return res.status(200).json({ success: true, data: address });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteAddress = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Address ID" });

    const address = await CustomerAddress.findOneAndUpdate(
      { _id: id, customerId },
      { $set: { status: false } },
      { new: true }
    );
    if (!address) return res.status(404).json({ success: false, message: "Address not found" });
    return res.status(200).json({ success: true, message: "Address removed successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Location Dropdowns ───────────────────────────────────────────────────────

export const getStates = async (_req: Request, res: Response) => {
  try {
    const states = await CustomerState.find({ active: true })
      .select("_id name stateCode")
      .sort({ name: 1 });
    return res.status(200).json({ success: true, data: states });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getDistrictsByState = async (req: Request, res: Response) => {
  try {
    const stateId = req.params.stateId as string;
    if (!mongoose.Types.ObjectId.isValid(stateId))
      return res.status(400).json({ success: false, message: "Invalid stateId" });
    const districts = await CustomerDistrict.find({ stateId, active: true })
      .select("_id name")
      .sort({ name: 1 });
    return res.status(200).json({ success: true, data: districts });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEducations = async (_req: Request, res: Response) => {
  try {
    const educations = await CustomerEducation.find({ status: true })
      .select("_id name")
      .sort({ name: 1 });
    return res.status(200).json({ success: true, data: educations });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/client/address/characteristic
 * Returns educations + active goals for onboarding screens. No auth.
 */
export const getCharacteristic = async (_req: Request, res: Response) => {
  try {
    const [educations, goals] = await Promise.all([
      CustomerEducation.find({ status: true }).select("_id name").sort({ name: 1 }),
      Goal.find({ isActive: true }).select("title image labels").sort({ createdAt: 1 }),
    ]);
    return res.status(200).json({ success: true, data: { educations, goals } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
