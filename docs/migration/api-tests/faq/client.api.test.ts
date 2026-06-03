import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

export async function runFaqClientApiTests(): Promise<boolean> {
  return runTests("faq (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("faq") },
    {
      name: "GET /api/v1/client/faq-types",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/faq-types", { token });
        const types = json.data as unknown[];
        if (!Array.isArray(types) || types.length < 1) throw new Error("client faq-types empty");
      },
    },
    {
      name: "GET /api/v1/client/faqs?type=general",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/faqs", {
          token,
          query: { type: "general" },
        });
        const list = json.data as unknown[];
        if (!Array.isArray(list) || list.length < 1) throw new Error("client general faqs empty");
      },
    },
    {
      name: "GET /api/v1/client/faqs?type=referral",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/faqs", {
          token,
          query: { type: "referral" },
        });
        const list = json.data as unknown[];
        if (!Array.isArray(list)) throw new Error("client referral faqs not an array");
      },
    },
  ]);
}
