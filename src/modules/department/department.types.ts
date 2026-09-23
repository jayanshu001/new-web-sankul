/**
 * Department (contact-us master) — stable API shape.
 *
 * Schema bridge: Mongo embeds `contacts[]` inside each department doc, while
 * legacy MySQL splits into two tables:
 *   ws_department          (name, decscription [typo], order, active)
 *   ws_department_contact  (department FK, mobile, isCallAvailable,
 *                           isWhatsAppAvailable, order, active)
 *
 * The transformer joins contact rows under each department's `contacts[]` and
 * maps `decscription` → `description`. Contact rows keep the legacy
 * `isCallAvailable` / `isWhatsAppAvailable` flags (additive vs the Mongo shape).
 */

export interface DepartmentContactDto {
  mobile: string;
  order: number;
  active: boolean;
  isCallAvailable: boolean;
  isWhatsAppAvailable: boolean;
}

export interface DepartmentDto {
  _id: string;
  name: string;
  description: string;
  order: number;
  active: boolean;
  contacts: DepartmentContactDto[];
}

export interface DepartmentContactInput {
  mobile: string;
  order?: number;
  active?: boolean;
  isCallAvailable?: boolean;
  isWhatsAppAvailable?: boolean;
}

export interface DepartmentCreateInput {
  name: string;
  description: string;
  order?: number;
  active?: boolean;
  contacts?: DepartmentContactInput[];
}

export interface DepartmentUpdateInput {
  name?: string;
  description?: string;
  order?: number;
  active?: boolean;
  contacts?: DepartmentContactInput[];
}
