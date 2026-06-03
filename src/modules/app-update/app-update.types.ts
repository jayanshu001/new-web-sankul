import type { UpdateType } from "../../models/enums";

/** Stable API / admin contract (matches Mongoose JSON shape). */
export interface AppUpdateDto {
  _id?: string;
  latestVersion: number;
  updateType: UpdateType;
  isUpdateAvailable: boolean;
}

export interface AppUpdateUpsertInput {
  latestVersion: number;
  updateType: UpdateType;
  isUpdateAvailable: boolean;
}

export const APP_UPDATE_DEFAULTS: AppUpdateDto = {
  latestVersion: 0,
  updateType: "flexible",
  isUpdateAvailable: false,
};
