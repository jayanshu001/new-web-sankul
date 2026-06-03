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

export const isMysqlModule = (module: string): boolean =>
  getMysqlMigrationModules().includes(module.trim().toLowerCase());

export const hasMysqlMigrationModules = (): boolean =>
  getMysqlMigrationModules().length > 0;
