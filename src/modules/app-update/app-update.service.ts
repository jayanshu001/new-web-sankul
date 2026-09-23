import { appUpdateRepository } from "./app-update.repository";
import { toAppUpdateDto } from "./app-update.transformer";
import type { AppUpdateDto, AppUpdateUpsertInput } from "./app-update.types";

export const getAppUpdateSettings = async (): Promise<AppUpdateDto> => {
  const row = await appUpdateRepository.findSingleton();
  return toAppUpdateDto(row);
};

export const upsertAppUpdateSettings = async (
  input: AppUpdateUpsertInput
): Promise<AppUpdateDto> => {
  const row = await appUpdateRepository.upsertSingleton(input);
  return toAppUpdateDto(row);
};
