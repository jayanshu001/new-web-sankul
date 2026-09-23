import type { Version } from "@prisma/client";
import type { VersionDto } from "./version.types";
import { VERSION_DEFAULTS } from "./version.types";

export const toVersionDto = (row: Version | null): VersionDto => {
  if (!row) return { ...VERSION_DEFAULTS };
  return {
    _id: String(row.id),
    latestVersionCode: row.latestVersionCode,
    lastSupportedVersionCode: row.lastSupportedVersionCode,
  };
};
