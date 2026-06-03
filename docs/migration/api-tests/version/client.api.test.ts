import { config } from "../_lib/env.js";
import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

export async function runVersionClientApiTests(): Promise<boolean> {
  return runTests("version (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("version") },
    {
      name: "GET /api/v1/client/version",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/version", { token });
        const data = json.data as {
          latestVersionCode?: number;
          lastSupportedVersionCode?: number;
        };
        if (data.latestVersionCode !== config.staging.versionLatestCode) {
          throw new Error(`latestVersionCode mismatch: ${data.latestVersionCode}`);
        }
      },
    },
    {
      name: "GET /api/v1/client/upgrade?clientVersion=40000",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/upgrade", {
          token,
          query: { clientVersion: 40000 },
        });
        const data = json.data as { latestVersion?: number; forceUpdate?: boolean };
        if (typeof data.latestVersion !== "number") {
          throw new Error("upgrade response missing latestVersion");
        }
      },
    },
  ]);
}
