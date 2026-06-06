import mongoose from "mongoose";
import { TermsAndConditions } from "../../models/system/TermsAndConditions.model";
import { isMysqlModule } from "../../config/migration";
import { termsRepository } from "./terms.repository";
import { toTermsDto } from "./terms.transformer";
import type { TermsCreateInput, TermsDto, TermsUpdateInput } from "./terms.types";

const MODULE = "terms";

export const parseTermsId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const fromMongoDoc = (d: Record<string, unknown>): TermsDto => ({
  _id: String(d._id),
  module: d.module as string,
  terms: d.terms as string,
  freeShippingMinimumOrderAmount: (d.freeShippingMinimumOrderAmount as number) ?? 0,
  status: (d.status as boolean) ?? true,
});

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

export const listTerms = async (): Promise<TermsDto[]> => {
  if (isMysqlModule(MODULE)) {
    const rows = await termsRepository.findMany();
    return rows.map(toTermsDto);
  }
  const docs = await TermsAndConditions.find().lean();
  return docs.map((d) => fromMongoDoc(d as Record<string, unknown>));
};

export const getTermsById = async (id: string): Promise<TermsDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseTermsId(id);
    if (!numId) return null;
    const row = await termsRepository.findById(numId);
    return row ? toTermsDto(row) : null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await TermsAndConditions.findById(id).lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};

export const createTerms = async (
  input: TermsCreateInput
): Promise<TermsDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await termsRepository.create(input);
    return toTermsDto(row);
  }
  const doc = await TermsAndConditions.create({
    module: input.module,
    terms: input.terms,
    freeShippingMinimumOrderAmount: input.freeShippingMinimumOrderAmount ?? 0,
    status: input.status ?? true,
  });
  return fromMongoDoc(doc.toObject() as unknown as Record<string, unknown>);
};

export const updateTerms = async (
  id: string,
  input: TermsUpdateInput
): Promise<TermsDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseTermsId(id);
    if (!numId) return null;
    try {
      const row = await termsRepository.update(numId, input);
      return toTermsDto(row);
    } catch {
      return null;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await TermsAndConditions.findByIdAndUpdate(
    id,
    { $set: input },
    { new: true }
  ).lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};

export const deleteTerms = async (id: string): Promise<boolean> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseTermsId(id);
    if (!numId) return false;
    try {
      await termsRepository.delete(numId);
      return true;
    } catch {
      return false;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await TermsAndConditions.findByIdAndDelete(id);
  return !!doc;
};

// ─── Client read ─────────────────────────────────────────────────────────────

/**
 * Client `GET /terms[?module=]`. Preserves legacy shape exactly:
 *  - with `module` → single active object or `null` (Mongo `findOne`)
 *  - without       → array of active terms (Mongo `find`)
 */
export const getClientTerms = async (
  moduleName?: string
): Promise<TermsDto | TermsDto[] | null> => {
  if (isMysqlModule(MODULE)) {
    if (moduleName) {
      const row = await termsRepository.findActiveByModule(moduleName);
      return row ? toTermsDto(row) : null;
    }
    const rows = await termsRepository.findMany({ activeOnly: true });
    return rows.map(toTermsDto);
  }

  const filter: Record<string, unknown> = { status: true };
  if (moduleName) filter.module = moduleName;
  if (moduleName) {
    const doc = await TermsAndConditions.findOne(filter).lean();
    return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
  }
  const docs = await TermsAndConditions.find(filter).lean();
  return docs.map((d) => fromMongoDoc(d as Record<string, unknown>));
};
