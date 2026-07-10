import { z } from "zod";

// Ids may arrive as a numeric MySQL id (e.g. 48) or a string ("48" / 24-hex
// ObjectId). Coerce number → string before validating so both are accepted.
const toIdString = (v: unknown) => (typeof v === "number" ? String(v) : v);
// Optional-id preprocess: an empty string means "not set / detach" — coerce it
// (and null) to null so `.nullable().optional()` accepts it instead of the regex
// rejecting "" as an "Invalid id".
const toOptIdString = (v: unknown) => (v === "" || v == null ? null : toIdString(v));
const optIdString = z.preprocess(toOptIdString, z.string().nullable().optional());
const idRegex = /^([0-9a-fA-F]{24}|\d+)$/;
const optRegexIdString = z.preprocess(toOptIdString, z.string().regex(idRegex, "Invalid id").nullable().optional());
const regexIdString = z.preprocess(toIdString, z.string().regex(idRegex, "Invalid id"));

const categoryRefSchema = z.object({
  category: z.string().min(1),
  order: z.number().int().optional(),
  status: z.boolean().optional(),
});

export const createPackageSchema = z.object({
  name: z.string().min(1).max(255),
  subtitle: z.string().max(255).optional(),
  description: z.string().default(""),
  image: z.string().max(500).optional(),
  shareableLink: z.string().max(500).optional(),
  withMaterialText: z.string().optional(),
  withoutMaterialText: z.string().optional(),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  packageTypeId: optIdString,
  goalId: optIdString,
  goalLabelId: optIdString,
  // Accept a 24-hex Mongo ObjectId OR a numeric MySQL id (SQL branch sends ints).
  examCountdownCategoryIds: z.array(regexIdString).optional(),
  examCountdownIds: z.array(regexIdString).optional(),
  packageCategoryId: optIdString,
  educatorId: optIdString,
  // Physical-material kit (PackageCourseMaterial). Accepts a 24-hex Mongo
  // ObjectId OR a numeric MySQL id (shared schema, like examCountdownIds). null
  // detaches. Copied onto the subscription's pc_material_id at payment-verify.
  pcMaterialId: optRegexIdString,
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

// ws_package_type is a name-only master (id + name + timestamps). order/active
// are intentionally NOT supported — see docs/admin/PACKAGE_TYPE_ADMIN.md.
export const createPackageTypeSchema = z.object({
  name: z.string().min(1).max(255),
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
