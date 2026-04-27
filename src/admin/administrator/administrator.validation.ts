import { z } from "zod";
import { AdminRole } from "../../models/enums";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const roleField = z
  .union([
    z.enum([AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.EDITOR]),
    z.string().regex(objectIdRegex, "Invalid role id"),
  ])
  .optional()
  .nullable();

export const createAdministratorSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().max(100).optional().nullable(),
  email: z.string().email("Invalid email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  role: roleField,
  status: z.coerce.boolean().optional().default(true),
  isDark: z.coerce.boolean().optional().default(false),
  image: z.string().max(1000).optional().nullable(),
});

export const updateAdministratorSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional().nullable(),
  email: z.string().email().max(255).optional(),
  password: z.string().min(8).max(128).optional(),
  role: roleField,
  status: z.coerce.boolean().optional(),
  isDark: z.coerce.boolean().optional(),
  image: z.string().max(1000).optional().nullable(),
});
