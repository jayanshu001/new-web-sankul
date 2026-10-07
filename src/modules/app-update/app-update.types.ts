// App update settings: DTO, input types and defaults.
import type { UpdateType } from "../../shared/enums";

/** Frozen API contract: live clients parse this shape. */
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
