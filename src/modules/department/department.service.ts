import mongoose from "mongoose";
import { Department } from "../../models/system/Department.model";
import { isMysqlModule } from "../../config/migration";
import { departmentRepository } from "./department.repository";
import { toDepartmentDto } from "./department.transformer";
import type {
  DepartmentContactDto,
  DepartmentCreateInput,
  DepartmentDto,
  DepartmentUpdateInput,
} from "./department.types";

const MODULE = "department";

export const parseDepartmentId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Mongo lean doc → DTO. Mongo contacts lack the call/whatsapp flags; default them. */
const fromMongoDoc = (d: Record<string, unknown>): DepartmentDto => {
  const contacts = ((d.contacts as Record<string, unknown>[]) ?? []).map((c) => ({
    mobile: c.mobile as string,
    order: (c.order as number) ?? 0,
    active: (c.active as boolean) ?? true,
    isCallAvailable: (c.isCallAvailable as boolean) ?? true,
    isWhatsAppAvailable: (c.isWhatsAppAvailable as boolean) ?? true,
  })) as DepartmentContactDto[];
  return {
    _id: String(d._id),
    name: d.name as string,
    description: (d.description as string) ?? "",
    order: (d.order as number) ?? 0,
    active: (d.active as boolean) ?? true,
    contacts,
  };
};

/** Admin list — all departments (+ contacts), sorted by `order`. */
export const listDepartments = async (): Promise<DepartmentDto[]> => {
  if (isMysqlModule(MODULE)) {
    const rows = await departmentRepository.findMany();
    return rows.map(toDepartmentDto);
  }

  const docs = await Department.find().sort({ order: 1 }).lean();
  return docs.map((d) => fromMongoDoc(d as Record<string, unknown>));
};

/**
 * Client contact-us — active departments only, each with active contacts
 * sorted by `order` (matches legacy `getContactUs` shaping).
 */
export const listActiveContactDepartments = async (): Promise<DepartmentDto[]> => {
  if (isMysqlModule(MODULE)) {
    const rows = await departmentRepository.findMany({ activeOnly: true });
    return rows.map(toDepartmentDto).map((d) => ({
      ...d,
      contacts: d.contacts.filter((c) => c.active).sort((a, b) => a.order - b.order),
    }));
  }

  const docs = await Department.find({ active: true }).sort({ order: 1 }).lean();
  return docs.map((d) => {
    const dto = fromMongoDoc(d as Record<string, unknown>);
    return {
      ...dto,
      contacts: dto.contacts.filter((c) => c.active).sort((a, b) => a.order - b.order),
    };
  });
};

export const createDepartment = async (
  input: DepartmentCreateInput
): Promise<DepartmentDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await departmentRepository.create(input);
    return toDepartmentDto(row!);
  }

  const doc = await Department.create(input);
  return fromMongoDoc(doc.toObject() as unknown as Record<string, unknown>);
};

export const updateDepartment = async (
  id: string,
  input: DepartmentUpdateInput
): Promise<DepartmentDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseDepartmentId(id);
    if (!numId) return null;
    try {
      const row = await departmentRepository.update(numId, input);
      return row ? toDepartmentDto(row) : null;
    } catch {
      return null;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Department.findByIdAndUpdate(
    id,
    { $set: input },
    { new: true }
  ).lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};

export const deleteDepartment = async (id: string): Promise<boolean> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseDepartmentId(id);
    if (!numId) return false;
    try {
      await departmentRepository.delete(numId);
      return true;
    } catch {
      return false;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await Department.findByIdAndDelete(id);
  return !!doc;
};
