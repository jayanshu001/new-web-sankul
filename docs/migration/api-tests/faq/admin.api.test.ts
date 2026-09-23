import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk, requestExpectStatus } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

export async function runFaqAdminApiTests(): Promise<boolean> {
  return runTests("faq (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("faq") },
    {
      name: "GET /api/v1/admin/cms/faq-types",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/faq-types", { token });
        const types = json.data as { _id?: string; title?: string }[];
        if (!Array.isArray(types) || types.length !== config.staging.faqTypeCount) {
          throw new Error(
            `expected ${config.staging.faqTypeCount} faq-types, got ${Array.isArray(types) ? types.length : "non-array"}`
          );
        }
        const general = types.find((t) => t._id === "general");
        if (!general?.title) throw new Error("missing synthetic type general");
      },
    },
    {
      name: "DELETE /api/v1/admin/cms/faq-types/general → 400 (MySQL fixed enums)",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestExpectStatus("DELETE", "/api/v1/admin/cms/faq-types/general", 400, {
          token,
        });
        if (!json.message?.includes("cannot be deleted")) {
          throw new Error(`unexpected message: ${json.message}`);
        }
      },
    },
    {
      name: "GET /api/v1/admin/cms/faqs",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/faqs", { token });
        const list = json.data as unknown[];
        if (!Array.isArray(list) || list.length < config.staging.faqMinCount) {
          throw new Error(`expected at least ${config.staging.faqMinCount} FAQs`);
        }
      },
    },
    {
      name: "GET /api/v1/admin/cms/faqs/:id",
      fn: async () => {
        const token = await getAdminToken();
        const list = (await requestOk("GET", "/api/v1/admin/cms/faqs", { token })).data as {
          _id?: string;
          question?: string;
        }[];
        const first = list[0];
        if (!first?._id) throw new Error("no FAQ id from list");

        const detail = await requestOk("GET", `/api/v1/admin/cms/faqs/${first._id}`, { token });
        const doc = detail.data as { question?: string; typeId?: { _id?: string } };
        if (doc.question !== first.question) throw new Error("GET by id question mismatch");
        if (!doc.typeId?._id) throw new Error("FAQ detail missing typeId");
      },
    },
    {
      name: "POST /api/v1/admin/cms/faqs",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const q = `migration-api-test-${Date.now()}`;
        const created = await requestOk("POST", "/api/v1/admin/cms/faqs", {
          token,
          body: { type: "general", question: q, answer: "test answer", isExpand: false },
        });
        const data = created.data as { _id?: string; question?: string; answer?: string };
        if (!data._id) throw new Error("create FAQ: no _id");
        if (data.question !== q) throw new Error("create FAQ: question mismatch");

        await requestOk("DELETE", `/api/v1/admin/cms/faqs/${data._id}`, { token });
      },
    },
    {
      name: "PUT /api/v1/admin/cms/faqs/:id",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const marker = `migration-put-${Date.now()}`;
        const created = await requestOk("POST", "/api/v1/admin/cms/faqs", {
          token,
          body: { type: "referral", question: marker, answer: "before", isExpand: true },
        });
        const id = (created.data as { _id: string })._id;

        await requestOk("PUT", `/api/v1/admin/cms/faqs/${id}`, {
          token,
          body: { answer: "after", isExpand: false },
        });

        const updated = await requestOk("GET", `/api/v1/admin/cms/faqs/${id}`, { token });
        const doc = updated.data as { answer?: string; isExpand?: boolean };
        if (doc.answer !== "after") throw new Error("PUT answer not persisted");
        if (doc.isExpand !== false) throw new Error("PUT isExpand not persisted");

        await requestOk("DELETE", `/api/v1/admin/cms/faqs/${id}`, { token });
      },
    },
  ]);
}
