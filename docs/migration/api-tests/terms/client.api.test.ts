import { config } from "../_lib/env.js";
import { getAdminToken, getCustomerToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Terms = { _id?: string; module?: string; terms?: string; status?: boolean };

export async function runTermsClientApiTests(): Promise<boolean> {
  return runTests("terms (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("terms") },
    {
      name: "GET /api/v1/client/terms → array of active terms",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/terms", { token });
        const list = json.data as Terms[];
        if (!Array.isArray(list)) throw new Error("expected an array when no module given");
        // Contract: only active (status:true) rows.
        for (const t of list) {
          if (t.status === false) throw new Error("inactive terms leaked into client list");
        }
      },
    },
    {
      name: "GET /api/v1/client/terms?module=<known> → single object or null (not array)",
      fn: async () => {
        const token = await getCustomerToken();
        // Discover a real active module from the unfiltered list.
        const list = (await requestOk("GET", "/api/v1/client/terms", { token })).data as Terms[];
        if (!list.length) return; // nothing active to assert against
        const mod = list[0].module!;
        const json = await requestOk("GET", "/api/v1/client/terms", { token, query: { module: mod } });
        const data = json.data as Terms | null;
        if (Array.isArray(data)) throw new Error("module filter must return a single object, not an array");
        if (!data || data.module !== mod) throw new Error("module filter returned wrong/empty doc");
        if (data.status === false) throw new Error("module filter returned inactive terms");
      },
    },
    {
      name: "GET /api/v1/client/terms?module=__nonexistent__ → null",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/terms", {
          token,
          query: { module: `__nope_${Date.now()}__` },
        });
        if (json.data !== null) throw new Error("unknown module should yield null");
      },
    },
    {
      name: "client list reflects only active rows (write-gated cross-check)",
      skip: config.skipWrite,
      fn: async () => {
        // Create an INACTIVE terms row via admin, confirm it is absent from the client list.
        // `module` is a fixed enum; use a real value and isolate the row by its unique `terms` marker.
        const adminToken = await getAdminToken();
        const custToken = await getCustomerToken();
        const termsMarker = `migration-inactive-${Date.now()}`;
        const created = await requestOk("POST", "/api/v1/admin/cms/terms", {
          token: adminToken,
          body: { module: "pendrive", terms: termsMarker, freeShippingMinimumOrderAmount: 0, status: false },
        });
        const id = (created.data as Terms)._id!;
        try {
          // The inactive row (identified by its unique terms text) must not surface in the active list.
          const list = (await requestOk("GET", "/api/v1/client/terms", { token: custToken }))
            .data as (Terms & { terms?: string })[];
          if (list.some((t) => t.terms === termsMarker)) {
            throw new Error("inactive terms appeared in client list");
          }
        } finally {
          await requestOk("DELETE", `/api/v1/admin/cms/terms/${id}`, { token: adminToken });
        }
      },
    },
  ]);
}
