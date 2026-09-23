import { versionRepository } from "./version.repository";
import { toVersionDto } from "./version.transformer";
import type { VersionDto, VersionUpsertInput } from "./version.types";

export const getVersionSettings = async (): Promise<VersionDto> => {
  const row = await versionRepository.findSingleton();
  return toVersionDto(row);
};

export const upsertVersionSettings = async (
  input: VersionUpsertInput
): Promise<VersionDto> => {
  const row = await versionRepository.upsertSingleton(input);
  return toVersionDto(row);
};
