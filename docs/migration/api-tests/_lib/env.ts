import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../../../");

dotenv.config({ path: path.join(projectRoot, ".env") });

/**
 * Array subclass used for `config.mysqlModules`. When MIGRATION_MYSQL_MODULES is
 * empty (post-Mongo-removal default: all modules are on MySQL) `includes()` always
 * returns true; when an explicit CSV is provided the normal Array behaviour applies.
 */
class MysqlModuleList extends Array<string> {
  private readonly assumeAll: boolean;
  constructor(items: string[], assumeAll: boolean) {
    super(...items);
    this.assumeAll = assumeAll;
    Object.setPrototypeOf(this, MysqlModuleList.prototype);
  }
  includes(value: string): boolean {
    return this.assumeAll || super.includes(value);
  }
}

function buildMysqlModules(raw: string | undefined): string[] {
  const items = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new MysqlModuleList(items, items.length === 0);
}

export const config = {
  projectRoot,
  baseUrl: (process.env.MIGRATION_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "4001"}`).replace(
    /\/$/,
    ""
  ),
  adminEmail: process.env.MIGRATION_TEST_ADMIN_EMAIL ?? "",
  adminPassword: process.env.MIGRATION_TEST_ADMIN_PASSWORD ?? "",
  customerPhone:
    process.env.MIGRATION_TEST_CUSTOMER_PHONE?.trim() ||
    process.env.TESTING_PHONE_NUMBERS?.split(",")[0]?.trim() ||
    "",
  customerOtp: process.env.MIGRATION_TEST_CUSTOMER_OTP ?? "5786",
  /** Write tests (PUT/POST/DELETE) run by default; set MIGRATION_API_SKIP_WRITE=true to skip. */
  skipWrite: process.env.MIGRATION_API_SKIP_WRITE === "true",
  /**
   * Default false → authenticated tests use the mock JWT stored in
   * api-tests/.auth.json. Set MIGRATION_TEST_REAL_LOGIN=true to authenticate
   * via real admin login / customer OTP instead.
   */
  realLogin: process.env.MIGRATION_TEST_REAL_LOGIN === "true",
  /**
   * Mongo removal is complete — every module now runs on MySQL, so the legacy
   * per-module MySQL gate is always satisfied. If MIGRATION_MYSQL_MODULES is unset
   * (the normal case), `.includes(anything)` returns true; an explicit CSV is still
   * honoured for narrowing during a partial run.
   */
  mysqlModules: buildMysqlModules(process.env.MIGRATION_MYSQL_MODULES),
  staging: {
    appUpdateLatestVersion: Number(process.env.MIGRATION_EXPECT_APP_UPDATE_VERSION ?? "4235200"),
    versionLatestCode: Number(process.env.MIGRATION_EXPECT_VERSION_CODE ?? "40976"),
    faqMinCount: Number(process.env.MIGRATION_EXPECT_FAQ_MIN ?? "1"),
    faqTypeCount: Number(process.env.MIGRATION_EXPECT_FAQ_TYPES ?? "2"),
  },
};
