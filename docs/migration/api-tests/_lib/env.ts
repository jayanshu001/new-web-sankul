import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../../../");

dotenv.config({ path: path.join(projectRoot, ".env") });

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
  mysqlModules: (process.env.MIGRATION_MYSQL_MODULES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  staging: {
    appUpdateLatestVersion: Number(process.env.MIGRATION_EXPECT_APP_UPDATE_VERSION ?? "4235200"),
    versionLatestCode: Number(process.env.MIGRATION_EXPECT_VERSION_CODE ?? "40976"),
    faqMinCount: Number(process.env.MIGRATION_EXPECT_FAQ_MIN ?? "1"),
    faqTypeCount: Number(process.env.MIGRATION_EXPECT_FAQ_TYPES ?? "2"),
  },
};
