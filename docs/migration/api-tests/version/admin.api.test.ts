import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

export async function runVersionAdminApiTests(): Promise<boolean> {
  return runTests("version (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("version") },
    {
      name: "GET /api/v1/admin/cms/version",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/version", { token });
        const data = json.data as {
          latestVersionCode?: number;
          lastSupportedVersionCode?: number;
        };
        if (data.latestVersionCode !== config.staging.versionLatestCode) {
          throw new Error(
            `latestVersionCode expected ${config.staging.versionLatestCode}, got ${data.latestVersionCode}`
          );
        }
        if (data.lastSupportedVersionCode !== config.staging.versionLatestCode) {
          throw new Error(
            `lastSupportedVersionCode expected ${config.staging.versionLatestCode}, got ${data.lastSupportedVersionCode}`
          );
        }
      },
    },
    {
      name: "PUT /api/v1/admin/cms/version (write + revert)",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const before = await requestOk("GET", "/api/v1/admin/cms/version", { token });
        const orig = before.data as {
          latestVersionCode: number;
          lastSupportedVersionCode: number;
        };

        const bumped = orig.latestVersionCode + 1;
        await requestOk("PUT", "/api/v1/admin/cms/version", {
          token,
          body: {
            latestVersionCode: bumped,
            lastSupportedVersionCode: orig.lastSupportedVersionCode,
          },
        });

        const after = await requestOk("GET", "/api/v1/admin/cms/version", { token });
        if ((after.data as { latestVersionCode: number }).latestVersionCode !== bumped) {
          throw new Error("PUT did not persist latestVersionCode");
        }

        await requestOk("PUT", "/api/v1/admin/cms/version", { token, body: orig });
        const restored = await requestOk("GET", "/api/v1/admin/cms/version", { token });
        if ((restored.data as { latestVersionCode: number }).latestVersionCode !== orig.latestVersionCode) {
          throw new Error("revert PUT failed");
        }
      },
    },
  ]);
}
