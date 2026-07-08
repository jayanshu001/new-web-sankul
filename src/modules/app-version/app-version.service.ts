import { getAppUpdateSettings } from "../app-update/app-update.service";
import { getVersionSettings } from "../version/version.service";
import { fetchAppStoreVersion } from "./app-version.appstore";
import type {
  AppVersionCheckInput,
  AppVersionCheckDto,
  VersionSource,
} from "./app-version.types";

/**
 * Compare two dotted version-name strings ("1.2.0" vs "1.3"). Returns:
 *   >0 when a is newer than b, <0 when older, 0 when equal.
 * Missing segments are treated as 0, so "1.2" == "1.2.0".
 */
export const compareVersionNames = (a: string, b: string): number => {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

const androidStoreUrl = (): string | null => {
  const explicit = process.env.ANDROID_STORE_URL?.trim();
  if (explicit) return explicit;
  const pkg = process.env.ANDROID_PACKAGE_NAME?.trim();
  return pkg ? `https://play.google.com/store/apps/details?id=${pkg}` : null;
};

/**
 * Resolve whether the calling app needs / must update.
 *
 * - iOS: latest version NAME is fetched live from the App Store (iTunes Lookup);
 *   admin config is the fallback when Apple is unreachable or unconfigured.
 * - Android: Play Store has no official version API, so "latest" comes from the
 *   admin-maintained config (AppUpdate.latestVersion / Version.latestVersionCode).
 * - Force-update is ALWAYS an our-side policy: any build below the admin
 *   `minSupportedVersion`, or an "immediate" update while one is available.
 */
export const checkAppVersion = async (
  input: AppVersionCheckInput
): Promise<AppVersionCheckDto> => {
  const { platform, currentVersion } = input;
  const currentVersionName = input.currentVersionName ?? null;

  const [appUpdate, version] = await Promise.all([
    getAppUpdateSettings(),
    getVersionSettings(),
  ]);

  const configLatestCode =
    appUpdate.latestVersion || version.latestVersionCode || 0;
  const minSupportedVersion = version.lastSupportedVersionCode || 0;
  const updateType = appUpdate.updateType;

  let latestVersion = configLatestCode;
  let latestVersionName: string | null = null;
  let storeUrl: string | null =
    platform === "android" ? androidStoreUrl() : process.env.IOS_APP_STORE_URL?.trim() || null;
  let source: VersionSource = "config";
  let releaseNotes: string | null = null;
  let isUpdateAvailable = false;

  if (platform === "ios") {
    const store = await fetchAppStoreVersion();
    if (store) {
      source = "app_store";
      latestVersionName = store.version;
      releaseNotes = store.releaseNotes;
      if (store.storeUrl) storeUrl = store.storeUrl;
      // Prefer the authoritative store version-name comparison for iOS.
      isUpdateAvailable = currentVersionName
        ? compareVersionNames(store.version, currentVersionName) > 0
        : currentVersion > 0 && currentVersion < configLatestCode;
    } else {
      // Store unreachable/unconfigured — fall back to numeric config compare.
      isUpdateAvailable = currentVersion > 0 && currentVersion < configLatestCode;
    }
  } else {
    // Android — numeric version-code compare against admin config.
    isUpdateAvailable = currentVersion > 0 && currentVersion < configLatestCode;
  }

  const belowFloor =
    currentVersion > 0 &&
    minSupportedVersion > 0 &&
    currentVersion < minSupportedVersion;
  const isForceUpdate =
    belowFloor || (isUpdateAvailable && updateType === "immediate");

  return {
    platform,
    currentVersion,
    currentVersionName,
    latestVersion,
    latestVersionName,
    minSupportedVersion,
    isUpdateAvailable,
    isForceUpdate,
    updateType,
    storeUrl,
    source,
    releaseNotes,
  };
};
