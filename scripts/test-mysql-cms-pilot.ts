/**
 * Smoke test: CMS pilot modules read from MySQL when MIGRATION_MYSQL_MODULES is set.
 *
 *   yarn db:test-cms-pilot
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const main = async () => {
  const { connectPrisma, disconnectPrisma } = await import("../src/config/prisma.ts");
  const { getAppUpdateSettings } = await import(
    "../src/modules/app-update/app-update.service.ts"
  );
  const { getVersionSettings } = await import("../src/modules/version/version.service.ts");

  await connectPrisma();
  try {
    const appUpdate = await getAppUpdateSettings();
    const version = await getVersionSettings();
    console.log("App update (MySQL path):", appUpdate);
    console.log("Version (MySQL path):", version);
    if (appUpdate.latestVersion < 1 && version.latestVersionCode < 1) {
      console.warn("Unexpected zeros — check MIGRATION_MYSQL_MODULES and dump import.");
    } else {
      console.log("CMS pilot OK — data loaded from staging MySQL.");
    }
  } finally {
    await disconnectPrisma();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
