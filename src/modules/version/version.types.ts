export interface VersionDto {
  _id?: string;
  latestVersionCode: number;
  lastSupportedVersionCode: number;
}

export interface VersionUpsertInput {
  latestVersionCode: number;
  lastSupportedVersionCode: number;
}

export const VERSION_DEFAULTS: VersionDto = {
  latestVersionCode: 0,
  lastSupportedVersionCode: 0,
};
