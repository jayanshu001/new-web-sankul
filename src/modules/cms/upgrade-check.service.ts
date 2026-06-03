import { getAppUpdateSettings } from "../app-update/app-update.service";
import { getVersionSettings } from "../version/version.service";

export interface UpgradeCheckResult {
  clientVersion: number;
  latestVersion: number;
  lastSupportedVersion: number;
  updateType: string;
  isUpdateAvailable: boolean;
  isForceUpdate: boolean;
}

export const checkClientUpgrade = async (
  clientVersion: number
): Promise<UpgradeCheckResult> => {
  const [appUpdate, version] = await Promise.all([
    getAppUpdateSettings(),
    getVersionSettings(),
  ]);

  const latest = appUpdate.latestVersion ?? version.latestVersionCode ?? 0;
  const lastSupported = version.lastSupportedVersionCode ?? 0;
  const isForceUpdate =
    clientVersion > 0 && clientVersion < lastSupported;
  const isUpdateAvailable =
    appUpdate.isUpdateAvailable ?? clientVersion < latest;

  return {
    clientVersion,
    latestVersion: latest,
    lastSupportedVersion: lastSupported,
    updateType: appUpdate.updateType ?? "flexible",
    isUpdateAvailable,
    isForceUpdate,
  };
};
