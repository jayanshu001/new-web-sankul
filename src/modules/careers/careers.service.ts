import { careersRepository } from "./careers.repository";
import { toCareerApplicationDto, toCareerOpeningDto } from "./careers.transformer";
import type {
  CareerApplicationCreateInput,
  CareerApplicationDto,
  CareerApplicationStatus,
  CareerOpeningCreateInput,
  CareerOpeningDto,
  CareerOpeningUpdateInput,
} from "./careers.types";

export const parseCareerId = (id: string): bigint | null => {
  if (!/^\d+$/.test(id)) return null;
  return BigInt(id);
};

// ── openings: admin ──────────────────────────────────────────────────────
export const listOpeningsPaged = async (q: {
  search?: string;
  status?: boolean;
  skip: number;
  take: number;
}): Promise<{ items: CareerOpeningDto[]; total: number }> => {
  const [rows, total] = await Promise.all([
    careersRepository.findOpeningsPage(q),
    careersRepository.countOpenings(q),
  ]);
  return { items: rows.map(toCareerOpeningDto), total };
};

export const getOpeningById = async (id: string): Promise<CareerOpeningDto | null> => {
  const numId = parseCareerId(id);
  if (numId === null) return null;
  const row = await careersRepository.findOpeningById(numId);
  return row ? toCareerOpeningDto(row) : null;
};

export const createOpening = async (input: CareerOpeningCreateInput): Promise<CareerOpeningDto> => {
  const row = await careersRepository.createOpening(input);
  return toCareerOpeningDto(row);
};

export const updateOpening = async (
  id: string,
  input: CareerOpeningUpdateInput
): Promise<CareerOpeningDto | null> => {
  const numId = parseCareerId(id);
  if (numId === null) return null;
  try {
    const row = await careersRepository.updateOpening(numId, input);
    return toCareerOpeningDto(row);
  } catch {
    return null;
  }
};

export const deleteOpening = async (id: string): Promise<boolean> => {
  const numId = parseCareerId(id);
  if (numId === null) return false;
  try {
    await careersRepository.deleteOpening(numId);
  } catch {
    return false;
  }
  return true;
};

// ── openings: public ──────────────────────────────────────────────────────
export const listActiveOpenings = async (): Promise<CareerOpeningDto[]> => {
  const rows = await careersRepository.findActiveOpenings();
  return rows.map(toCareerOpeningDto);
};

// ── applications: admin ──────────────────────────────────────────────────
export const listApplicationsPaged = async (q: {
  openingId?: string;
  status?: CareerApplicationStatus;
  skip: number;
  take: number;
}): Promise<{ items: CareerApplicationDto[]; total: number }> => {
  const openingId = q.openingId ? parseCareerId(q.openingId) ?? undefined : undefined;
  const opts = { openingId, status: q.status, skip: q.skip, take: q.take };
  const [rows, total] = await Promise.all([
    careersRepository.findApplicationsPage(opts),
    careersRepository.countApplications(opts),
  ]);
  return { items: rows.map(toCareerApplicationDto), total };
};

export const getApplicationById = async (id: string): Promise<CareerApplicationDto | null> => {
  const numId = parseCareerId(id);
  if (numId === null) return null;
  const row = await careersRepository.findApplicationById(numId);
  return row ? toCareerApplicationDto(row) : null;
};

export const updateApplicationStatus = async (
  id: string,
  status: CareerApplicationStatus
): Promise<CareerApplicationDto | null> => {
  const numId = parseCareerId(id);
  if (numId === null) return null;
  try {
    const row = await careersRepository.updateApplicationStatus(numId, status);
    return toCareerApplicationDto(row);
  } catch {
    return null;
  }
};

// ── applications: public submit ──────────────────────────────────────────
export const submitApplication = async (
  input: CareerApplicationCreateInput
): Promise<CareerApplicationDto> => {
  const row = await careersRepository.createApplication(input);
  return toCareerApplicationDto(row);
};
