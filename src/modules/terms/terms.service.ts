import { termsRepository } from "./terms.repository";
import { toTermsDto } from "./terms.transformer";
import type { TermsCreateInput, TermsDto, TermsUpdateInput } from "./terms.types";

export const parseTermsId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

export const listTerms = async (): Promise<TermsDto[]> => {
  const rows = await termsRepository.findMany();
  return rows.map(toTermsDto);
};

export const getTermsById = async (id: string): Promise<TermsDto | null> => {
  const numId = parseTermsId(id);
  if (!numId) return null;
  const row = await termsRepository.findById(numId);
  return row ? toTermsDto(row) : null;
};

export const createTerms = async (
  input: TermsCreateInput
): Promise<TermsDto> => {
  const row = await termsRepository.create(input);
  return toTermsDto(row);
};

export const updateTerms = async (
  id: string,
  input: TermsUpdateInput
): Promise<TermsDto | null> => {
  const numId = parseTermsId(id);
  if (!numId) return null;
  try {
    const row = await termsRepository.update(numId, input);
    return toTermsDto(row);
  } catch {
    return null;
  }
};

export const deleteTerms = async (id: string): Promise<boolean> => {
  const numId = parseTermsId(id);
  if (!numId) return false;
  try {
    await termsRepository.delete(numId);
    return true;
  } catch {
    return false;
  }
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
  if (moduleName) {
    const row = await termsRepository.findActiveByModule(moduleName);
    return row ? toTermsDto(row) : null;
  }
  const rows = await termsRepository.findMany({ activeOnly: true });
  return rows.map(toTermsDto);
};
