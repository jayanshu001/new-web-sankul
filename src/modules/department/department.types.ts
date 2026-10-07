// Departments: DTO and input types.

/**
 * API embeds `contacts[]` per department; storage is ws_department (with the
 * legacy `decscription` typo) + ws_department_contact.
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
