/**
 * Run all migration HTTP API tests (migrated modules only).
 *
 *   yarn migration:api
 */
import { MIGRATED_API_MODULES } from "./modules.manifest.js";
import { runAppUpdateApiTests } from "./app-update/admin.api.test.js";
import { runAppUpdateClientApiTests } from "./app-update/client.api.test.js";
import { runVersionAdminApiTests } from "./version/admin.api.test.js";
import { runVersionClientApiTests } from "./version/client.api.test.js";
import { runFaqAdminApiTests } from "./faq/admin.api.test.js";
import { runFaqClientApiTests } from "./faq/client.api.test.js";

async function main() {
  console.log("Migrated modules:", MIGRATED_API_MODULES.map((m) => m.key).join(", "));

  const suites = [
    runAppUpdateApiTests,
    runAppUpdateClientApiTests,
    runVersionAdminApiTests,
    runVersionClientApiTests,
    runFaqAdminApiTests,
    runFaqClientApiTests,
  ];

  let ok = true;
  for (const run of suites) {
    if (!(await run())) ok = false;
  }

  console.log(ok ? "\nAll migration API test suites passed." : "\nSome migration API tests failed.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
