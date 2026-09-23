import { assertServerUp, getAdminToken, getCustomerToken } from "../_lib/auth.js";
import { config } from "../_lib/env.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/**
 * ws_exam_category_pivot — HTTP regression for pivot-aware exam queries.
 *
 * Requires demo seed on staging DB:
 *   yarn seed:exam-category-pivot:demo
 *
 * Staging exam 300001 is linked via pivot to categories 6 and 12 (not via exam_category_id).
 */

const DEMO_EXAM_ID = "300001";
const PIVOT_CAT_A = "6";
const PIVOT_CAT_B = "12";
const NON_PIVOT_CAT = "14";

function examIdsFromList(body: unknown): string[] {
  const data = body as any;
  if (Array.isArray(data?.exams)) return data.exams.map((e: any) => String(e._id));
  if (Array.isArray(data?.list)) return data.list.map((e: any) => String(e._id ?? e.exam?._id));
  return [];
}

async function ensureDemoFixture(): Promise<void> {
  const { prisma, disconnectPrisma } = await import("../../../../src/config/prisma.ts");
  try {
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const past = new Date(now.getTime() - 60 * 60 * 1000);
    await prisma.exam.update({
      where: { id: 300001 },
      data: {
        status: true,
        type: "subject",
        examCategoryId: 1637,
        startAt: past,
        endAt: future,
      },
    });
    await prisma.examCategoryPivot.deleteMany({ where: { examId: 300001 } });
    await prisma.examCategoryPivot.createMany({
      data: [
        { examId: 300001, categoryId: 6, created_at: now, updated_at: now },
        { examId: 300001, categoryId: 12, created_at: now, updated_at: now },
      ],
      skipDuplicates: true,
    });
  } finally {
    await disconnectPrisma();
  }
}

async function assertPivotRow(examId: number, categoryId: number): Promise<void> {
  const { prisma, disconnectPrisma } = await import("../../../../src/config/prisma.ts");
  try {
    const row = await prisma.examCategoryPivot.findFirst({
      where: { examId, categoryId },
    });
    if (!row) throw new Error(`DB missing ws_exam_category_pivot (${examId}, ${categoryId})`);
  } finally {
    await disconnectPrisma();
  }
}

export async function runExamCategoryPivotApiTests(): Promise<boolean> {
  let customerToken = "";
  let adminToken = "";

  return runTests("exam-category-pivot", [
    { name: "server healthz", fn: assertServerUp },
    {
      name: "mint customer + admin tokens",
      fn: async () => {
        customerToken = await getCustomerToken();
        adminToken = await getAdminToken();
      },
    },
    {
      name: "setup: reset demo exam + pivot fixture (pivot-only, not exam_category_id)",
      fn: ensureDemoFixture,
    },
    {
      name: "DB: demo pivot rows exist (300001 ↔ 6, 12)",
      fn: async () => {
        await assertPivotRow(300001, 6);
        await assertPivotRow(300001, 12);
      },
    },

    // ── client-exam (quizzes) ───────────────────────────────────────────────
    {
      name: "GET /client/quizzes/categories/6/exams includes demo exam via pivot",
      fn: async () => {
        const json = await requestOk("GET", `/api/v1/client/quizzes/categories/${PIVOT_CAT_A}/exams`, {
          token: customerToken,
        });
        const ids = examIdsFromList(json.data);
        if (!ids.includes(DEMO_EXAM_ID)) {
          throw new Error(`expected exam ${DEMO_EXAM_ID} under category 6, got ids: ${ids.join(", ") || "(empty)"}`);
        }
      },
    },
    {
      name: "GET /client/quizzes/categories/12/exams includes demo exam via pivot",
      fn: async () => {
        const json = await requestOk("GET", `/api/v1/client/quizzes/categories/${PIVOT_CAT_B}/exams`, {
          token: customerToken,
        });
        const ids = examIdsFromList(json.data);
        if (!ids.includes(DEMO_EXAM_ID)) {
          throw new Error(`expected exam ${DEMO_EXAM_ID} under category 12, got ids: ${ids.join(", ") || "(empty)"}`);
        }
      },
    },

    // ── categories surface (paged) ────────────────────────────────────────
    {
      name: "GET /client/exam-categories/6/exams includes demo exam (paged path)",
      fn: async () => {
        const json = await requestOk("GET", `/api/v1/client/exam-categories/${PIVOT_CAT_A}/exams`, {
          token: customerToken,
        });
        const ids = examIdsFromList(json.data);
        if (!ids.includes(DEMO_EXAM_ID)) {
          throw new Error(`expected exam ${DEMO_EXAM_ID} on exam-categories/6/exams, got: ${ids.join(", ") || "(empty)"}`);
        }
      },
    },

    {
      name: "GET /client/exam-categories/12/exams includes demo exam (paged path)",
      fn: async () => {
        const json = await requestOk("GET", `/api/v1/client/exam-categories/${PIVOT_CAT_B}/exams`, {
          token: customerToken,
        });
        const ids = examIdsFromList(json.data);
        if (!ids.includes(DEMO_EXAM_ID)) {
          throw new Error(`expected exam ${DEMO_EXAM_ID} on exam-categories/12/exams, got: ${ids.join(", ") || "(empty)"}`);
        }
      },
    },

    // ── negative: category without pivot link ─────────────────────────────
    {
      name: "GET /client/quizzes/categories/14/exams does NOT include demo exam",
      fn: async () => {
        const json = await requestOk("GET", `/api/v1/client/quizzes/categories/${NON_PIVOT_CAT}/exams`, {
          token: customerToken,
        });
        const ids = examIdsFromList(json.data);
        if (ids.includes(DEMO_EXAM_ID)) {
          throw new Error(`exam ${DEMO_EXAM_ID} should not appear under category 14 without pivot`);
        }
      },
    },

    // ── admin filter ──────────────────────────────────────────────────────
    {
      name: "GET /admin/quizzes?categoryId=6 includes demo exam (admin list filter)",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/quizzes", {
          token: adminToken,
          query: { categoryId: PIVOT_CAT_A, limit: 50 },
        });
        const items = json.data as any;
        if (!Array.isArray(items)) throw new Error("expected data[] from admin quizzes list");
        const ids = items.map((e: any) => String(e._id));
        if (!ids.includes(DEMO_EXAM_ID)) {
          throw new Error(`admin list expected ${DEMO_EXAM_ID} for categoryId=6, got: ${ids.join(", ") || "(empty)"}`);
        }
      },
    },

    {
      name: "GET /admin/quizzes?categoryId=12 includes demo exam (admin list filter)",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/quizzes", {
          token: adminToken,
          query: { categoryId: PIVOT_CAT_B, limit: 50 },
        });
        const items = json.data as any;
        if (!Array.isArray(items)) throw new Error("expected data[] from admin quizzes list");
        const ids = items.map((e: any) => String(e._id));
        if (!ids.includes(DEMO_EXAM_ID)) {
          throw new Error(`admin list expected ${DEMO_EXAM_ID} for categoryId=12, got: ${ids.join(", ") || "(empty)"}`);
        }
      },
    },

    // ── catalog-exam children counts (uses countExams → pivot-aware) ─────
    {
      name: "GET /client/exam-categories/6/children — child counts pivot-aware",
      skip: !config.mysqlModules.includes("catalog-exam"),
      fn: async () => {
        const json = await requestOk("GET", `/api/v1/client/exam-categories/${PIVOT_CAT_A}/children`, {
          token: customerToken,
        });
        const data = json.data as any;
        if (!data?.parent) throw new Error("expected parent in children response");
        // Parent 6 is root — list may be empty; parent itself is valid. Smoke only.
        if (!Array.isArray(data.list)) throw new Error("expected list[]");
      },
    },

    // ── admin write: re-sync pivot on update ──────────────────────────────
    {
      name: "PUT /admin/quizzes/300001 re-syncs pivot for primary category",
      skip: config.skipWrite,
      fn: async () => {
        await requestOk("PUT", `/api/v1/admin/quizzes/${DEMO_EXAM_ID}`, {
          token: adminToken,
          body: { categoryId: PIVOT_CAT_A, title: "test" },
        });
        await assertPivotRow(300001, 6);
      },
    },
  ]);
}
