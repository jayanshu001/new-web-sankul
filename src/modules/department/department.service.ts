// Departments: admin CRUD and the client contact-us listing.
import { departmentRepository } from "./department.repository";
import { toDepartmentDto } from "./department.transformer";
import type {
  DepartmentCreateInput,
  DepartmentDto,
  DepartmentUpdateInput,
} from "./department.types";
import { parsePositiveInt } from "../../utils/parseId";

export const parseDepartmentId = parsePositiveInt;

export interface ListDepartmentsOptions {
  page?: number;
  limit?: number;
  /** Omit for all departments. */
  active?: boolean;
}

export interface ListDepartmentsResult {
  items: DepartmentDto[];
  total: number;
}

// Admin list, newest first; paginates only when both page and limit are given.
export const listDepartments = async (
  opts: ListDepartmentsOptions = {}
): Promise<ListDepartmentsResult> => {
  const { page, limit, active } = opts;
  const paginate = page !== undefined && limit !== undefined;
  const skip = paginate ? (page - 1) * limit : undefined;

  const [rows, total] = await Promise.all([
    departmentRepository.findMany({ active, skip, take: paginate ? limit : undefined, recency: true }),
    departmentRepository.count({ active }),
  ]);
  return { items: rows.map(toDepartmentDto), total };
};

/** Client contact-us: active departments, each with active contacts sorted by `order`. */
export const listActiveContactDepartments = async (): Promise<DepartmentDto[]> => {
  const rows = await departmentRepository.findMany({ active: true });
  return rows.map(toDepartmentDto).map((d) => ({
    ...d,
    contacts: d.contacts.filter((c) => c.active).sort((a, b) => a.order - b.order),
  }));
};

export const createDepartment = async (
  input: DepartmentCreateInput
): Promise<DepartmentDto> => {
  const row = await departmentRepository.create(input);
  return toDepartmentDto(row!);
};

export const updateDepartment = async (
  id: string,
  input: DepartmentUpdateInput
): Promise<DepartmentDto | null> => {
  const numId = parseDepartmentId(id);
  if (!numId) return null;
  try {
    const row = await departmentRepository.update(numId, input);
    return row ? toDepartmentDto(row) : null;
  } catch {
    return null;
  }
};

export const deleteDepartment = async (id: string): Promise<boolean> => {
  const numId = parseDepartmentId(id);
  if (!numId) return false;
  try {
    await departmentRepository.delete(numId);
    return true;
  } catch {
    return false;
  }
};
