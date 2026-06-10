import { assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/**
 * customer-lookups (client) — state / education / characteristic lookups served
 * from MySQL (ws_customer_state / ws_customer_education / ws_customer_target_goal)
 * via src/client/address/address.controller.ts when `customer-lookups` is enabled.
 *
 * These endpoints are PUBLIC (no auth in address.routes.ts), so no token needed.
 * Contract parity asserted: states → { _id, name, stateCode }; educations → { _id, name }.
 */

type State = { _id?: string; name?: string; stateCode?: string };
type Education = { _id?: string; name?: string };

export async function runCustomerLookupsClientApiTests(): Promise<boolean> {
  return runTests("customer-lookups (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("customer-lookups") },

    {
      name: "GET /api/v1/client/address/states → array of { _id, name, stateCode }",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/client/address/states");
        const list = json.data as State[];
        if (!Array.isArray(list)) throw new Error("expected an array of states");
        if (!list.length) throw new Error("expected at least one active state (staging has 12)");
        for (const s of list) {
          if (!s._id || typeof s._id !== "string") throw new Error("state _id must be a non-empty string");
          if (!s.name) throw new Error("state missing name");
          if (!("stateCode" in s)) throw new Error("state missing stateCode (contract drift)");
          // MySQL contract projection must NOT leak `active`/internal fields.
          if ("active" in (s as Record<string, unknown>)) throw new Error("`active` leaked into state DTO");
        }
      },
    },

    {
      name: "GET /api/v1/client/address/states?search=<known> → filtered subset",
      fn: async () => {
        const all = (await requestOk("GET", "/api/v1/client/address/states")).data as State[];
        if (!all.length) return;
        const term = all[0].name!.slice(0, 3);
        const filtered = (await requestOk("GET", "/api/v1/client/address/states", { query: { search: term } }))
          .data as State[];
        if (!Array.isArray(filtered)) throw new Error("search must return an array");
        if (filtered.length > all.length) throw new Error("search returned more rows than the full list");
        for (const s of filtered) {
          if (!s.name?.toLowerCase().includes(term.toLowerCase()))
            throw new Error(`search result "${s.name}" does not match term "${term}"`);
        }
      },
    },

    {
      name: "GET /api/v1/client/address/educations → array of { _id, name }",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/client/address/educations");
        const list = json.data as Education[];
        if (!Array.isArray(list)) throw new Error("expected an array of educations");
        if (!list.length) throw new Error("expected at least one active education (staging has 10)");
        for (const e of list) {
          if (!e._id || typeof e._id !== "string") throw new Error("education _id must be a non-empty string");
          if (!e.name) throw new Error("education missing name");
          if ("status" in (e as Record<string, unknown>)) throw new Error("`status` leaked into education DTO");
        }
      },
    },

    {
      name: "GET /api/v1/client/address/characteristic → { educations, goals }",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/client/address/characteristic");
        const data = json.data as { educations?: Education[]; goals?: unknown[] };
        if (!data || !Array.isArray(data.educations)) throw new Error("characteristic.educations must be an array");
        if (!Array.isArray(data.goals)) throw new Error("characteristic.goals must be an array");
        for (const e of data.educations) {
          if (!e._id || !e.name) throw new Error("characteristic education missing _id/name");
        }
      },
    },
  ]);
}
