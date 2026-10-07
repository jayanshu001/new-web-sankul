// Departments: row to DTO mapping and Prisma write data (response shape is frozen).
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

/** Maps the `decscription` column typo → `description`; contacts sorted by `order`. */
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

/** Department FK is added by the caller. */
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
