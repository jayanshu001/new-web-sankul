import { assertServerUp, getCustomerToken } from "../_lib/auth.js";
import { requestOk, requestExpectStatus } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Catalog · Exam (`catalog-exam`) — category NAVIGATION surface (mirrors
 * catalog-material). WIRED behind `isExamMysql()` (flag OFF):
 * `GET /client/exam-categories/:id/children` from `ws_exam_category` (children
 * via the SQL `parent_id` self-FK, active = status&&!deleted) + `ws_exam`
 * (per-child UNCONDITIONAL count). MySQL data path proven via tsx.
 *
 * SCOPE: the exam ITEM listing/attempt surface is NOT migrated. Route requires a
 * Bearer token. Parent id differs between paths (ObjectId vs int 86), so the
 * MySQL-specific assertion is flag-gated.
 */

const examMysql = config.mysqlModules.includes("catalog-exam");

export async function runCatalogExamClientApiTests(): Promise<boolean> {
  let token = "";
  return runTests("catalog-exam (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "mint customer token", fn: async () => { token = await getCustomerToken(); } },

    {
      name: "GET /exam-categories/:id/children with a bad id → 400 (contract holds either path)",
      fn: async () => {
        await requestExpectStatus("GET", "/api/v1/client/exam-categories/not-an-id/children", 400, { token });
      },
    },
    {
      name: "[catalog-exam ON] /exam-categories/86/children → parent + 13 children w/ count + havingChildDirectory + title=name",
      skip: !examMysql,
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/exam-categories/86/children", { token })).data as any;
        if (!data?.parent || data.parent._id !== "86") throw new Error("expected parent category 86");
        if (!Array.isArray(data.list)) throw new Error("expected list[]");
        if (data.list.length !== 13) throw new Error(`expected 13 active children of 86, got ${data.list.length}`);
        const child = data.list[0].category;
        if (typeof child.count !== "number") throw new Error("child missing numeric count");
        if (typeof child.havingChildDirectory !== "boolean") throw new Error("child missing havingChildDirectory");
        if (child.title !== child.name) throw new Error("exam category title must mirror name");
      },
    },
  ]);
}
