import { z } from "zod";

const objectIdRegex = /^([0-9a-fA-F]{24}|[1-9]\d*)$/;
// Accept either a Mongo ObjectId (24-hex) OR a MySQL numeric id, so the same
// validation works on both migration backends (admin-video runs on MySQL where
// ids are integers). Mirrors the dual-id handling in administrator.validation.ts.
// Coerce first: the FE sends MySQL category ids as JSON numbers (e.g. 12), so
// without coercion z.string() rejects them with "Invalid id".
const objectIdSchema = z.coerce.string().refine(
  (v) => objectIdRegex.test(v) || /^[1-9]\d*$/.test(v),
  { message: "Invalid id" }
);

const baseShape = {
  name: z.string().min(1, "Name is required").max(255),
  slug: z.string().min(1, "Slug is required").max(255),
  // No `.default(0)`: an omitted order must stay undefined so the service can
  // assign the TOP slot (utils/listOrdering). Defaulting to 0 would tie the new
  // row with every existing order=0 video and the id tie-break would bury it.
  // An explicit order is still honoured as-is.
  order: z.coerce.number().int().optional(),
  topic: z.string().max(500).optional().default(""),
  type: z.enum(["free", "paid"]).optional().default("free"),
  videoCategoryId: objectIdSchema,
  status: z.coerce.boolean().optional().default(true),

  youtube: z.coerce.boolean().optional().default(false),
  youtubeId: z.string().max(255).optional().nullable(),

  // vimeo: z.coerce.boolean().optional().default(false),
  // vimeoId: z.string().max(255).optional().nullable(),

  aws: z.coerce.boolean().optional().default(false),
  awsId: z.string().max(255).optional().nullable(),
};

export const createVideoSchema = z
  .object(baseShape)
  .superRefine((val, ctx) => {
    const enabled = [
      ["youtube", val.youtube, val.youtubeId] as const,
      // ["vimeo", val.vimeo, val.vimeoId] as const,
      ["aws", val.aws, val.awsId] as const,
    ].filter(([, on]) => on);

    if (enabled.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platform"],
        message: "At least one of youtube/aws must be enabled",
      });
      return;
    }
    if (enabled.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platform"],
        message: "Only one of youtube/aws can be enabled at a time",
      });
      return;
    }
    const [name, , id] = enabled[0];
    if (!id || !String(id).trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${name}Id`],
        message: `${name}Id is required when ${name} is enabled`,
      });
    }
  });

export const updateVideoSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(255).optional(),
    order: z.coerce.number().int().optional(),
    topic: z.string().max(500).optional(),
    type: z.enum(["free", "paid"]).optional(),
    videoCategoryId: objectIdSchema.optional(),
    status: z.coerce.boolean().optional(),

    youtube: z.coerce.boolean().optional(),
    youtubeId: z.string().max(255).optional().nullable(),
    // vimeo: z.coerce.boolean().optional(),
    // vimeoId: z.string().max(255).optional().nullable(),
    aws: z.coerce.boolean().optional(),
    awsId: z.string().max(255).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const touchedAny =
      val.youtube !== undefined || /* val.vimeo !== undefined || */ val.aws !== undefined;
    if (!touchedAny) return;

    const enabled = [
      ["youtube", val.youtube, val.youtubeId] as const,
      // ["vimeo", val.vimeo, val.vimeoId] as const,
      ["aws", val.aws, val.awsId] as const,
    ].filter(([, on]) => on === true);

    if (enabled.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platform"],
        message: "Only one of youtube/aws can be enabled at a time",
      });
      return;
    }
    if (enabled.length === 1) {
      const [name, , id] = enabled[0];
      if (id !== undefined && (!id || !String(id).trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`${name}Id`],
          message: `${name}Id is required when ${name} is enabled`,
        });
      }
    }
  });

export const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  type: z.enum(["free", "paid"]).optional(),
  platform: z.enum(["youtube", "vimeo", "aws"]).optional(),
  videoCategoryId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(20),
  sort_by: z.enum(["name", "order", "created_at", "updated_at"]).optional().default("order"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const reorderSchema = z.object({
  orders: z
    .array(z.object({ id: objectIdSchema, order: z.coerce.number().int().min(0) }))
    .min(1, "orders array is required"),
});

export const sortFieldMap: Record<string, string> = {
  name: "title",
  order: "order",
  created_at: "createdAt",
  updated_at: "updatedAt",
};
