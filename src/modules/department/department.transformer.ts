import type { Department, DepartmentContact } from "@prisma/client";
import type {
  DepartmentContactDto,
  DepartmentContactInput,
  DepartmentDto,
} from "./department.types";

type DepartmentWithContacts = Department & { contacts?: DepartmentContact[] };

const toContactDto = (c: DepartmentContact): DepartmentContactDto => ({
  mobile: c.mobile,
  order: c.order,
  active: c.active,
  isCallAvailable: c.isCallAvailable,
  isWhatsAppAvailable: c.isWhatsAppAvailable,
});

/**
 * MySQL row (+ joined contacts) → API DTO.
 * Bridges the legacy `decscription` typo → `description` and sorts contacts
 * by `order` to match the Mongo embedded-array ordering.
 */
export const toDepartmentDto = (row: DepartmentWithContacts): DepartmentDto => ({
  _id: String(row.id),
  name: row.name,
  description: row.decscription,
  order: row.order,
  active: row.active,
  contacts: (row.contacts ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(toContactDto),
});

/** Department scalar fields → Prisma create/update data (no contacts). */
export const toPrismaDepartmentScalars = (input: {
  name?: string;
  description?: string;
  order?: number;
  active?: boolean;
}) => ({
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.description !== undefined ? { decscription: input.description } : {}),
  ...(input.order !== undefined ? { order: input.order } : {}),
  ...(input.active !== undefined ? { active: input.active } : {}),
});

/** Contact input → Prisma `ws_department_contact` row data (department FK added by caller). */
export const toPrismaContactData = (
  c: DepartmentContactInput,
  fallbackOrder: number
) => ({
  mobile: c.mobile,
  order: c.order ?? fallbackOrder,
  active: c.active ?? true,
  isCallAvailable: c.isCallAvailable ?? true,
  isWhatsAppAvailable: c.isWhatsAppAvailable ?? true,
});
