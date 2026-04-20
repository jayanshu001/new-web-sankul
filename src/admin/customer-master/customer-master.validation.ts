import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createStateSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  stateCode: z.string().min(1, "State code is required").max(55),
  active: z.boolean().optional().default(true),
});
export const updateStateSchema = createStateSchema.partial();

export const createDistrictSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  stateId: z.string().regex(objectIdRegex, "Invalid stateId"),
  active: z.boolean().optional().default(true),
});
export const updateDistrictSchema = createDistrictSchema.partial();

export const createEducationSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  status: z.boolean().optional().default(true),
});
export const updateEducationSchema = createEducationSchema.partial();

export const createTargetGoalSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  image: z.string().min(1, "Image is required"),
  active: z.boolean().optional().default(true),
});
export const updateTargetGoalSchema = createTargetGoalSchema.partial();
