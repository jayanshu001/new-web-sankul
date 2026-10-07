// Customer addresses: DTO and input types.

/**
 * Ids, phones and pincode are returned as strings; state is an id, not a
 * populated object. City is a plain name string (no city id).
 */
export interface AddressDto {
  _id: string;
  name: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  address: string;
  address2: string;
  city: string;
  stateId: string | null;
  pincode: string;
  label: string | null;
  isDefault: boolean;
  customerId: string | null;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AddressCreateInput {
  customerId: number;
  name: string;
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  address: string;
  address2?: string;
  city: string;
  stateId?: number | null;
  pincode: string;
  label?: string | null;
  status?: boolean;
}

export type AddressUpdateInput = Partial<Omit<AddressCreateInput, "customerId">>;
