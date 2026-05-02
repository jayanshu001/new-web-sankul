import { z } from "zod";

const categoryRefSchema = z.object({
  category: z.string().min(1),
  order: z.number().int().optional(),
  status: z.boolean().optional(),
});

export const createPackageSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(""),
  image: z.string().max(500).optional(),
  shareableLink: z.string().max(500).optional(),
  withMaterialText: z.string().optional(),
  withoutMaterialText: z.string().optional(),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
  isMagazine: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  packageTypeId: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  goalLabelId: z.string().nullable().optional(),
  pcMaterialId: z.string().nullable().optional(),
  educatorId: z.string().nullable().optional(),
  specificSubjects: z.array(categoryRefSchema).optional(),
  materialCategories: z.array(categoryRefSchema).optional(),
  examCategories: z.array(categoryRefSchema).optional(),
  notificationTopic: z.string().max(255).optional(),
});

export const updatePackageSchema = createPackageSchema.partial();

export const reorderPackagesSchema = z.object({
  orders: z.array(z.object({ id: z.string(), order: z.number().int() })).min(1),
});

export const reorderEmbeddedSchema = z.object({
  orders: z.array(z.object({ category: z.string(), order: z.number().int() })).min(1),
});

export const attachPlansSchema = z.object({
  planIds: z.array(z.string().min(1)).min(1),
});

export const createPackageTypeSchema = z.object({
  name: z.string().min(1).max(255),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const updatePackageTypeSchema = createPackageTypeSchema.partial();

// Chat
export const createChatMessageSchema = z.object({
  text: z.string().optional(),
  mediaUrl: z.string().max(1000).optional(),
  mediaType: z.enum(["image", "video", "pdf", "audio", "other"]).optional(),
  sendPush: z.boolean().optional(),
});

// Video-category relation management
export const setRelationsSchema = z.object({
  videoCategoryRelationIds: z.array(z.string().min(1)),
});
