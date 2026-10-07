// Offline cities: client city list and admin city CRUD.
import { offlineCityRepository as repo } from "./offline-city.repository";
import { toCityDto } from "./offline-city.transformer";
import { CityDto } from "./offline-city.types";
import { nextOrder } from "../../utils/listOrdering";
import { prisma } from "../../config/prisma";

export const parseCityId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Optional `stateId` scopes to one state (cities with no state are excluded). */
export const listActiveCities = async (search?: string, stateId?: number): Promise<CityDto[]> => {
  const rows = await repo.listActive({ search: search?.trim() || undefined, stateId });
  return rows.map(toCityDto);
};

type Envelope<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export const listCitiesAdmin = async (opts?: {
  status?: boolean;
  stateId?: number;
  search?: string;
  skip?: number;
  take?: number;
}): Promise<{ data: CityDto[]; total: number }> => {
  const [rows, total] = await Promise.all([repo.listAll(opts), repo.countAll(opts)]);
  return { data: rows.map(toCityDto), total };
};

export const getCityAdmin = async (id: number): Promise<CityDto | null> => {
  const row = await repo.findById(id);
  return row ? toCityDto(row) : null;
};

export const createCityAdmin = async (input: {
  name: string; image: string; order?: number; status?: boolean; stateId?: number | null;
}): Promise<CityDto> => {
  const order = input.order ?? nextOrder((await prisma.offlineCity.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { order: true } }))?.order);
  const row = await repo.create({
    name: input.name, image: input.image, order, status: input.status ?? true,
    state: input.stateId ?? null,
  });
  return toCityDto(row);
};

export const updateCityAdmin = async (
  id: number,
  input: { name?: string; image?: string; order?: number; status?: boolean; stateId?: number | null }
): Promise<Envelope<CityDto>> => {
  const exists = await repo.findById(id);
  if (!exists) return { ok: false, status: 404, message: "City not found." };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.image !== undefined) data.image = input.image;
  if (input.order !== undefined) data.order = input.order;
  if (input.status !== undefined) data.status = input.status;
  if (input.stateId !== undefined) data.state = input.stateId;
  const row = await repo.update(id, data);
  return { ok: true, data: toCityDto(row) };
};

// Refused (409) while the city still has centers.
export const deleteCityAdmin = async (id: number): Promise<Envelope<null>> => {
  const exists = await repo.findById(id);
  if (!exists) return { ok: false, status: 404, message: "City not found." };
  const centers = await repo.countCenters(id);
  if (centers > 0)
    return { ok: false, status: 409, message: `Cannot delete — city has ${centers} centers.` };
  await repo.remove(id);
  return { ok: true, data: null };
};
