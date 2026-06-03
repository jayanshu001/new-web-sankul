import type { AppUpdate } from "@prisma/client";
import type { AppUpdateDto, AppUpdateUpsertInput } from "./app-update.types";
import { APP_UPDATE_DEFAULTS } from "./app-update.types";
import type { UpdateType } from "../../models/enums";

/** MySQL column retains legacy typo `isUpdateAvailble`. */
export const toAppUpdateDto = (row: AppUpdate | null): AppUpdateDto => {
  if (!row) return { ...APP_UPDATE_DEFAULTS };
  return {
    _id: String(row.id),
    latestVersion: row.latestVersion,
    updateType: row.updateType as UpdateType,
    isUpdateAvailable: row.isUpdateAvailble,
  };
};

export const toPrismaAppUpdateWrite = (input: AppUpdateUpsertInput) => ({
  latestVersion: input.latestVersion,
  updateType: input.updateType,
  isUpdateAvailble: input.isUpdateAvailable,
});
