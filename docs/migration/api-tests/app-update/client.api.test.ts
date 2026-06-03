import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/** Client upgrade path uses app-update + version from MySQL via upgrade-check.service */
export async function runAppUpdateClientApiTests(): Promise<boolean> {
  return runTests("app-update (client via /upgrade)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("app-update") },
    {
      name: "GET /api/v1/client/upgrade (app-update + version)",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/upgrade", {
          token,
          query: { clientVersion: 40000 },
        });
        const data = json.data as { latestVersion?: number; forceUpdate?: boolean };
        if (typeof data.latestVersion !== "number") {
          throw new Error("upgrade missing latestVersion (includes app-update settings)");
        }
      },
    },
  ]);
}
