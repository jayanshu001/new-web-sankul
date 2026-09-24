import { careersRepository } from "./careers.repository";
import { toCareerApplicationDto, toCareerOpeningDto } from "./careers.transformer";
import type {
  CareerApplicationCreateInput,
  CareerApplicationDto,
  CareerApplicationListParams,
  CareerApplicationStatus,
  CareerOpeningCreateInput,
  CareerOpeningDto,
  CareerOpeningListParams,
  CareerOpeningUpdateInput,
  PagedResult,
} from "./careers.types";

export const parseCareerId = (id: string): bigint | null =>
  /^\d+$/.test(id) ? BigInt(id) : null;

const readById = async <T>(id: string, run: (id: bigint) => Promise<T>): Promise<T | null> => {
  const parsed = parseCareerId(id);
  return parsed === null ? null : run(parsed);
};

const writeById = async <T>(id: string, run: (id: bigint) => Promise<T>): Promise<T | null> => {
  try {
    return await readById(id, run);
  } catch {
    return null;
  }
};

export const listOpeningsPaged = async (
  params: CareerOpeningListParams
): Promise<PagedResult<CareerOpeningDto>> => {
  const [rows, total] = await Promise.all([
    careersRepository.findOpeningsPage(params),
    careersRepository.countOpenings(params),
  ]);

  return { items: rows.map(toCareerOpeningDto), total };
};

export const getOpeningById = (id: string): Promise<CareerOpeningDto | null> =>
  readById(id, async (openingId) => {
    const row = await careersRepository.findOpeningById(openingId);
    return row ? toCareerOpeningDto(row) : null;
  });

export const createOpening = async (input: CareerOpeningCreateInput): Promise<CareerOpeningDto> =>
  toCareerOpeningDto(await careersRepository.createOpening(input));

export const updateOpening = (
  id: string,
  input: CareerOpeningUpdateInput
): Promise<CareerOpeningDto | null> =>
  writeById(id, async (openingId) =>
    toCareerOpeningDto(await careersRepository.updateOpening(openingId, input))
  );

export const deleteOpening = async (id: string): Promise<boolean> => {
  const deleted = await writeById(id, async (openingId) => {
    await careersRepository.deleteOpening(openingId);
    return true;
  });

  return deleted ?? false;
};

export const listActiveOpenings = async (): Promise<CareerOpeningDto[]> =>
  (await careersRepository.findActiveOpenings()).map(toCareerOpeningDto);

export const listApplicationsPaged = async (query: {
  openingId?: string;
  status?: CareerApplicationStatus;
  skip: number;
  take: number;
}): Promise<PagedResult<CareerApplicationDto>> => {
  const params: CareerApplicationListParams = {
    openingId: query.openingId ? parseCareerId(query.openingId) ?? undefined : undefined,
    status: query.status,
    skip: query.skip,
    take: query.take,
  };

  const [rows, total] = await Promise.all([
    careersRepository.findApplicationsPage(params),
    careersRepository.countApplications(params),
  ]);

  return { items: rows.map(toCareerApplicationDto), total };
};

export const getApplicationById = (id: string): Promise<CareerApplicationDto | null> =>
  readById(id, async (applicationId) => {
    const row = await careersRepository.findApplicationById(applicationId);
    return row ? toCareerApplicationDto(row) : null;
  });

export const updateApplicationStatus = (
  id: string,
  status: CareerApplicationStatus
): Promise<CareerApplicationDto | null> =>
  writeById(id, async (applicationId) =>
    toCareerApplicationDto(await careersRepository.updateApplicationStatus(applicationId, status))
  );

export const submitApplication = async (
  input: CareerApplicationCreateInput
): Promise<CareerApplicationDto> =>
  toCareerApplicationDto(await careersRepository.createApplication(input));
