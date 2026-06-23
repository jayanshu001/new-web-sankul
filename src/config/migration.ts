/**
 * Controls which modules read/write MySQL (Prisma) vs MongoDB (Mongoose).
 *
 * Aligns with docs/migration/legacy_system_migration_strategy.md Phase 2–3:
 * migrate module-by-module while keeping API response contracts stable.
 *
 * Set in .env:
 *   MIGRATION_MYSQL_MODULES=app-update,version
 *
 * When any module is listed, DATABASE_URL must be set and Prisma connects at boot.
 */

const DEFAULT_MODULES: string[] = [];

export const getMysqlMigrationModules = (): string[] => {
  const raw = process.env.MIGRATION_MYSQL_MODULES?.trim();
  if (!raw) return DEFAULT_MODULES;
  return raw
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
};

/**
 * MySQL-only mode: the migration is complete and Mongo is permanently retired.
 * EVERY module reads/writes MySQL (Prisma), regardless of MIGRATION_MYSQL_MODULES,
 * and the Mongo connection is never opened. `_module` is accepted for call-site
 * compatibility but no longer gates anything.
 */
export const isMysqlModule = (_module: string): boolean => true;

// Always true so Prisma connects at boot (every path is MySQL now).
export const hasMysqlMigrationModules = (): boolean => true;

/**
 * MongoDB is permanently disabled — the app runs MySQL-only and never connects
 * to Mongo. Kept as a function (returning false) so existing call sites compile.
 */
export const isMongoFallbackEnabled = (): boolean => false;
