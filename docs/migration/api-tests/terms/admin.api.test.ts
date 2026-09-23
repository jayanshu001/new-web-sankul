import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Terms = {
  _id?: string;
  module?: string;
  terms?: string;
  freeShippingMinimumOrderAmount?: number;
  status?: boolean;
};

export async function runTermsAdminApiTests(): Promise<boolean> {
  return runTests("terms (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("terms") },
    {
      name: "GET /api/v1/admin/cms/terms",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/terms", { token });
        const list = json.data as Terms[];
        if (!Array.isArray(list) || list.length < 1) throw new Error("expected at least 1 terms row");
        const first = list[0];
        if (!first.module) throw new Error("terms missing module");
        if (typeof first.freeShippingMinimumOrderAmount !== "number") {
          throw new Error("terms missing numeric freeShippingMinimumOrderAmount");
        }
        if (typeof first.status !== "boolean") throw new Error("terms missing boolean status");
      },
    },
    {
      name: "GET /api/v1/admin/cms/terms/:id",
      fn: async () => {
        const token = await getAdminToken();
        const list = (await requestOk("GET", "/api/v1/admin/cms/terms", { token })).data as Terms[];
        const first = list[0];
        if (!first?._id) throw new Error("no terms id from list");
        const detail = await requestOk("GET", `/api/v1/admin/cms/terms/${first._id}`, { token });
        const doc = detail.data as Terms;
        if (doc.module !== first.module) throw new Error("GET by id module mismatch");
      },
    },
    {
      name: "POST + PUT + DELETE /api/v1/admin/cms/terms",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        // `module` is a legacy MySQL enum (book|pendrive|referral code) — must use a valid value.
        const created = await requestOk("POST", "/api/v1/admin/cms/terms", {
          token,
          body: { module: "book", terms: "before", freeShippingMinimumOrderAmount: 250, status: true },
        });
        const data = created.data as Terms;
        if (!data._id) throw new Error("create: no _id");
        if (data.module !== "book") throw new Error("create: module mismatch");
        if (data.freeShippingMinimumOrderAmount !== 250) throw new Error("create: fsm not persisted");

        await requestOk("PUT", `/api/v1/admin/cms/terms/${data._id}`, {
          token,
          body: { terms: "after", freeShippingMinimumOrderAmount: 0, status: false },
        });
        const updated = (await requestOk("GET", `/api/v1/admin/cms/terms/${data._id}`, { token }))
          .data as Terms;
        if (updated.terms !== "after") throw new Error("PUT terms not persisted");
        if (updated.freeShippingMinimumOrderAmount !== 0) throw new Error("PUT fsm not persisted");
        if (updated.status !== false) throw new Error("PUT status not persisted");

        await requestOk("DELETE", `/api/v1/admin/cms/terms/${data._id}`, { token });
      },
    },
    {
      name: "POST invalid module value → 400 (MySQL fixed enum)",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const { request } = await import("../_lib/http.js");
        const { status } = await request("POST", "/api/v1/admin/cms/terms", {
          token,
          body: { module: `bad-${Date.now()}`, terms: "x", freeShippingMinimumOrderAmount: 0, status: true },
        });
        if (status !== 400) throw new Error(`expected 400 for invalid module enum, got ${status}`);
      },
    },
  ]);
}
