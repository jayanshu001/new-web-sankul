import { Version } from "../../models/system/Version.model";
import { isMysqlModule } from "../../config/migration";
import { versionRepository } from "./version.repository";
import { toVersionDto } from "./version.transformer";
import type { VersionDto, VersionUpsertInput } from "./version.types";
import { VERSION_DEFAULTS } from "./version.types";

const MODULE = "version";

export const getVersionSettings = async (): Promise<VersionDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await versionRepository.findSingleton();
    return toVersionDto(row);
  }

  const doc = await Version.findOne().lean();
  if (!doc) return { ...VERSION_DEFAULTS };
  return {
    _id: doc._id?.toString(),
    latestVersionCode: doc.latestVersionCode,
    lastSupportedVersionCode: doc.lastSupportedVersionCode,
  };
};

export const upsertVersionSettings = async (
  input: VersionUpsertInput
): Promise<VersionDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await versionRepository.upsertSingleton(input);
    return toVersionDto(row);
  }

  const doc = await Version.findOneAndUpdate(
    {},
    { $set: input },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return {
    _id: doc?._id?.toString(),
    latestVersionCode: doc!.latestVersionCode,
    lastSupportedVersionCode: doc!.lastSupportedVersionCode,
  };
};
