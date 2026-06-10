import type { OfflineCity } from "@prisma/client";
import type { CityDto, CityNameDto } from "./offline-city.types";

export const toCityDto = (row: OfflineCity): CityDto => ({
  _id: String(row.id),
  name: row.name,
  image: row.image,
  status: row.status,
  order: row.order,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

export const toCityNameDto = (row: Pick<OfflineCity, "id" | "name">): CityNameDto => ({
  _id: String(row.id),
  name: row.name,
});
