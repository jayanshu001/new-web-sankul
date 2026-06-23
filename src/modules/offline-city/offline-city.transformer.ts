import type { CityDto, CityNameDto } from "./offline-city.types";

// Row shape from queries that include the State relation (see repository stateInclude).
type CityRowWithState = {
  id: number;
  name: string;
  image: string;
  status: boolean;
  order: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  State?: { id: number; name: string; state_code: string } | null;
};

export const toCityDto = (row: CityRowWithState): CityDto => ({
  _id: String(row.id),
  name: row.name,
  image: row.image,
  status: row.status,
  order: row.order,
  stateId: row.State
    ? { _id: String(row.State.id), name: row.State.name, stateCode: row.State.state_code }
    : null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

export const toCityNameDto = (row: { id: number; name: string }): CityNameDto => ({
  _id: String(row.id),
  name: row.name,
});
