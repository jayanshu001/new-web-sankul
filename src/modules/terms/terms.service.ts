import { termsRepository } from "./terms.repository";
import { toTermsDto } from "./terms.transformer";
import type { TermsCreateInput, TermsDto, TermsModule, TermsUpdateInput } from "./terms.types";
import { TERMS_MODULES } from "./terms.types";

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

/**
 * ONE ROW PER MODULE is the model, not a convention.
 *
 * The client resolves a module with `findActiveByModule` — a `findFirst` — so a
 * second active row for the same module SILENTLY SHADOWS the first: the admin
 * edits one row and the app keeps rendering the other, with no error anywhere.
 * `module` is an enum of two live values and both already have a row, so a create
 * can now only ever produce that duplicate.
 *
 * Enforced here AND by a unique index
 * (docs/migration/schema-changes/2026-08-20_terms_module_unique.sql) — the index is
 * the guarantee, this check is what turns it into a readable 409 instead of a
 * driver error.
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

/** Narrowing helper so controllers don't duck-type the union. */
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

// ─── Client read ─────────────────────────────────────────────────────────────

/**
 * Normalise a caller-supplied terms module filter. Same contract as
 * `resolveFaqTypeFilter`: case/space-insensitive, and an unknown value is an
 * explicit failure rather than a silent one.
 *
 * Silent failure here is quieter than the FAQ case but just as wrong — an exact
 * `findFirst` on a bad module returns `data: null`, which the app renders as
 * "there are no terms" rather than "you asked for the wrong thing". `?module=
 * Referral code` (label casing) would have done exactly that.
 *
 * `ws_termsandcondition.module` is a MySQL enum, so TERMS_MODULES cannot drift
 * from the database without a schema change.
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

/** Human-readable list for the 422 message. */
export const TERMS_MODULE_FILTER_MESSAGE = `Invalid \`module\`. Allowed: ${TERMS_MODULES.join(", ")}.`;

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

/**
 * Module-level T&C TEXT, or "" when there is no active row for that module.
 *
 * This is the fallback source for products that carry their own per-product T&C
 * column but were created (or migrated) without one — today: books
 * (`ws_book.terms_and_conditions`, nullable since 2026-08-18). The product
 * service asks for the module text ONCE per request and hands it to the
 * transformer; see `catalog-book.service`.
 *
 * Deliberately returns "" rather than null: every consumer's DTO field is a
 * non-null string, so a missing global row must collapse to the same empty
 * string a missing per-product value does.
 */
export const getModuleTermsText = async (module: TermsModule): Promise<string> => {
  const row = await termsRepository.findActiveByModule(module);
  return row?.terms?.trim() ? row.terms : "";
};
