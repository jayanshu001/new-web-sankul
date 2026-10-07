// Terms and conditions: admin CRUD (one row per module) and client terms.
import { termsRepository } from "./terms.repository";
import { toTermsDto } from "./terms.transformer";
import type { ClientTermsDto, TermsCreateInput, TermsDto, TermsModule, TermsUpdateInput } from "./terms.types";
import { TERMS_MODULES } from "./terms.types";
import { departmentRepository } from "../department/department.repository";
import { toDepartmentDto } from "../department/department.transformer";

export const parseTermsId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

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

/**
 * One row per module is the model: the client resolves a module with `findFirst`,
 * so a second row for the same module silently shadows the first. Enforced by a
 * unique index (docs/migration/schema-changes/2026-08-20_terms_module_unique.sql);
 * this check turns the violation into a readable 409 instead of a driver error.
 */
export type TermsWriteConflict = { conflict: "module_exists"; module: string; existingId: number };

const moduleTaken = async (
  module: string,
  exceptId?: number
): Promise<TermsWriteConflict | null> => {
  const row = await termsRepository.findAnyByModule(module);
  if (!row || row.id === exceptId) return null;
  return { conflict: "module_exists", module, existingId: row.id };
};

export const createTerms = async (
  input: TermsCreateInput
): Promise<TermsDto | TermsWriteConflict> => {
  const clash = await moduleTaken(input.module);
  if (clash) return clash;
  const row = await termsRepository.create(input);
  return toTermsDto(row);
};

export const updateTerms = async (
  id: string,
  input: TermsUpdateInput
): Promise<TermsDto | TermsWriteConflict | null> => {
  const numId = parseTermsId(id);
  if (!numId) return null;
  // Only a module CHANGE can collide; `exceptId` keeps a plain re-save of the same
  // row (module unchanged) from colliding with itself.
  if (input.module !== undefined) {
    const clash = await moduleTaken(input.module, numId);
    if (clash) return clash;
  }
  try {
    const row = await termsRepository.update(numId, input);
    return toTermsDto(row);
  } catch {
    return null;
  }
};

export const isTermsConflict = (v: unknown): v is TermsWriteConflict =>
  !!v && typeof v === "object" && (v as TermsWriteConflict).conflict === "module_exists";

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

/**
 * Normalise a caller-supplied module filter (case/space-insensitive, same contract
 * as `resolveFaqTypeFilter`). An unknown value fails explicitly instead of
 * returning `data: null`, which the app would render as "no terms".
 * `ws_termsandcondition.module` is a MySQL enum, so TERMS_MODULES cannot drift.
 */
export const resolveTermsModuleFilter = (
  moduleName?: string
): { ok: true; module?: TermsModule } | { ok: false } => {
  const raw = (moduleName ?? "").trim();
  if (!raw) return { ok: true, module: undefined }; // absent → every active module
  const match = (TERMS_MODULES as readonly string[]).find(
    (m) => m.toLowerCase() === raw.toLowerCase()
  );
  return match ? { ok: true, module: match as TermsModule } : { ok: false };
};

export const TERMS_MODULE_FILTER_MESSAGE = `Invalid \`module\`. Allowed: ${TERMS_MODULES.join(", ")}.`;

/**
 * Client `GET /terms[?module=]`: with `module` → single active object or `null`;
 * without → array of active terms.
 */
export const getClientTerms = async (
  moduleName?: string
): Promise<ClientTermsDto | ClientTermsDto[] | null> => {
  if (moduleName) {
    const row = await termsRepository.findActiveByModule(moduleName);
    return row ? withContacts(toTermsDto(row)) : null;
  }
  const rows = await termsRepository.findMany({ activeOnly: true });
  return Promise.all(rows.map((r) => withContacts(toTermsDto(r))));
};

/**
 * Terms module → ws_department id whose ACTIVE contacts ride along as the
 * module's helpline numbers. Book/E-Book questions go to "Publication Helpline
 * Number" (id 3). Referral has no helpline, so it is absent → `contacts: []`.
 * ponytail: ids pinned by hand, add a ws_department column if a 3rd mapping shows up.
 */
const TERMS_HELPLINE_DEPARTMENT: Partial<Record<TermsModule, number>> = { book: 3 };

const withContacts = async (dto: TermsDto): Promise<ClientTermsDto> => {
  const deptId = TERMS_HELPLINE_DEPARTMENT[dto.module as TermsModule];
  const dept = deptId ? await departmentRepository.findById(deptId) : null;
  const contacts = dept?.active ? toDepartmentDto(dept).contacts.filter((c) => c.active) : [];
  return { ...dto, contacts };
};

/**
 * Module-level T&C text, or "" when there is no active row. Fallback for products
 * whose own per-product T&C column is empty (books; see `catalog-book.service`),
 * resolved once per request. Returns "" (not null) because consumers' DTO fields
 * are non-null strings.
 */
export const getModuleTermsText = async (module: TermsModule): Promise<string> => {
  const row = await termsRepository.findActiveByModule(module);
  return row?.terms?.trim() ? row.terms : "";
};
