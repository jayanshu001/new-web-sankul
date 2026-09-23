/**
 * Copy to: docs/migration/api-tests/<module-key>/admin.api.test.ts
 * Register in run-module.ts and run-all.ts
 */
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

const MODULE_KEY = "your-module-key";

export async function runYourModuleAdminApiTests(): Promise<boolean> {
  return runTests(MODULE_KEY, [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule(MODULE_KEY) },
    {
      name: "GET /api/v1/admin/...",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/your-path", { token });
        // assert json.data ...
        void json;
      },
    },
  ]);
}
