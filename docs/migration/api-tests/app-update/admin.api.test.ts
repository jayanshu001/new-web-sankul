import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

export async function runAppUpdateApiTests(): Promise<boolean> {
  return runTests("app-update (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("app-update") },
    {
      name: "GET /api/v1/admin/cms/app-update",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/app-update", { token });
        const data = json.data as {
          latestVersion?: number;
          updateType?: string;
          isUpdateAvailable?: boolean;
        };
        if (data.latestVersion !== config.staging.appUpdateLatestVersion) {
          throw new Error(
            `latestVersion expected ${config.staging.appUpdateLatestVersion}, got ${data.latestVersion}`
          );
        }
        if (!data.updateType) throw new Error("missing updateType");
        if (typeof data.isUpdateAvailable !== "boolean") {
          throw new Error("isUpdateAvailable should be boolean (transformer from isUpdateAvailble)");
        }
      },
    },
    {
      name: "PUT /api/v1/admin/cms/app-update (write + revert)",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const before = await requestOk("GET", "/api/v1/admin/cms/app-update", { token });
        const orig = before.data as {
          latestVersion: number;
          updateType: string;
          isUpdateAvailable: boolean;
        };

        const bumped = orig.latestVersion + 1;
        await requestOk("PUT", "/api/v1/admin/cms/app-update", {
          token,
          body: {
            latestVersion: bumped,
            updateType: orig.updateType,
            isUpdateAvailable: orig.isUpdateAvailable,
          },
        });

        const after = await requestOk("GET", "/api/v1/admin/cms/app-update", { token });
        const data = after.data as { latestVersion: number };
        if (data.latestVersion !== bumped) {
          throw new Error(`PUT did not persist latestVersion (got ${data.latestVersion})`);
        }

        await requestOk("PUT", "/api/v1/admin/cms/app-update", { token, body: orig });
        const restored = await requestOk("GET", "/api/v1/admin/cms/app-update", { token });
        if ((restored.data as { latestVersion: number }).latestVersion !== orig.latestVersion) {
          throw new Error("revert PUT failed");
        }
      },
    },
  ]);
}
