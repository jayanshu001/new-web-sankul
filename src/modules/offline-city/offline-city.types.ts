// Offline cities: DTO types.
/** Populated parent state (or null). */
export interface CityStateRef {
  _id: string;
  name: string;
  stateCode: string;
}

export interface CityDto {
  _id: string;
  name: string;
  image: string;
  status: boolean;
  order: number;
  stateId: CityStateRef | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CityNameDto {
  _id: string;
  name: string;
}
