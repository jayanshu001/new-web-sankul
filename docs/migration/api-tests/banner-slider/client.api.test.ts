import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Banner = { key?: string; keyRef?: string; keyId?: unknown; orderBy?: number };

export async function runBannerSliderClientApiTests(): Promise<boolean> {
  return runTests("banner-slider (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("banner-slider") },
    {
      name: "GET /api/v1/client/banners",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/banners", { token });
        const list = json.data as Banner[];
        if (!Array.isArray(list)) throw new Error("client banners not an array");
        for (let i = 1; i < list.length; i++) {
          if ((list[i - 1].orderBy ?? 0) > (list[i].orderBy ?? 0)) {
            throw new Error("client banners not sorted by orderBy asc");
          }
        }
      },
    },
    {
      name: "GET /api/v1/client/banners?key=Packages (filter by Mongo-cased key)",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/banners", {
          token,
          query: { key: "Packages" },
        });
        const list = json.data as Banner[];
        if (!Array.isArray(list)) throw new Error("filtered banners not an array");
        // Every returned banner (if any) must match the requested key.
        for (const b of list) {
          if (b.key !== "Packages") throw new Error(`key filter leaked: got ${b.key}`);
        }
      },
    },
  ]);
}
