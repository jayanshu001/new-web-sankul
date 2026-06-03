import { AppUpdate } from "../../models/system/AppUpdate.model";
import { isMysqlModule } from "../../config/migration";
import { appUpdateRepository } from "./app-update.repository";
import { toAppUpdateDto } from "./app-update.transformer";
import type { AppUpdateDto, AppUpdateUpsertInput } from "./app-update.types";
import { APP_UPDATE_DEFAULTS } from "./app-update.types";

const MODULE = "app-update";

export const getAppUpdateSettings = async (): Promise<AppUpdateDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await appUpdateRepository.findSingleton();
    return toAppUpdateDto(row);
  }

  const doc = await AppUpdate.findOne().lean();
  if (!doc) return { ...APP_UPDATE_DEFAULTS };
  return {
    _id: doc._id?.toString(),
    latestVersion: doc.latestVersion,
    updateType: doc.updateType,
    isUpdateAvailable: doc.isUpdateAvailable,
  };
};

export const upsertAppUpdateSettings = async (
  input: AppUpdateUpsertInput
): Promise<AppUpdateDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await appUpdateRepository.upsertSingleton(input);
    return toAppUpdateDto(row);
  }

  const doc = await AppUpdate.findOneAndUpdate(
    {},
    { $set: input },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return {
    _id: doc?._id?.toString(),
    latestVersion: doc!.latestVersion,
    updateType: doc!.updateType,
    isUpdateAvailable: doc!.isUpdateAvailable,
  };
};
