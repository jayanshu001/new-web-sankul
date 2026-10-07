// App version check: request and response types.
import type { UpdateType } from "../../shared/enums";

export type AppPlatform = "ios" | "android";

/** Where the "latest" version number was ultimately sourced from. */
export type VersionSource = "app_store" | "config";

export interface AppVersionCheckInput {
  platform: AppPlatform;
  /** Numeric build / version code the client is running (e.g. 120). */
  currentVersion: number;
  /** Human-readable version name the client is running (e.g. "1.2.0"). Optional. */
  currentVersionName?: string;
}

export interface AppVersionCheckDto {
  platform: AppPlatform;
  currentVersion: number;
  currentVersionName: string | null;
  /** Latest known build/version code (Android: admin config; iOS: config fallback). */
  latestVersion: number;
  /** Latest human-readable version name (iOS: live from App Store; else config). */
  latestVersionName: string | null;
  /** Our-side floor: builds below this are forced to update. */
  minSupportedVersion: number;
  isUpdateAvailable: boolean;
  /** True when the client MUST update before continuing (our-side policy). */
  isForceUpdate: boolean;
  /** immediate → hard gate hint; flexible → soft/optional. */
  updateType: UpdateType;
  storeUrl: string | null;
  /** "app_store" when the number came live from Apple, else "config". */
  source: VersionSource;
  /** App Store release notes for the latest version (iOS only, best-effort). */
  releaseNotes: string | null;
}
