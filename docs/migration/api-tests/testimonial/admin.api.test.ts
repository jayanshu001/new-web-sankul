import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

export async function runTestimonialAdminApiTests(): Promise<boolean> {
  return runTests("testimonial (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("testimonial") },
    {
      name: "GET /api/v1/admin/cms/testimonials (sorted rating desc)",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/testimonials", { token });
        const list = json.data as { _id?: string; rating?: number; description?: string }[];
        if (!Array.isArray(list) || list.length < 1) throw new Error("expected at least 1 testimonial");
        // Contract: legacy MySQL `discription` column is exposed as `description`.
        if (list[0].description === undefined) throw new Error("missing description field (discription bridge)");
        // Contract: rating sorted descending.
        for (let i = 1; i < list.length; i++) {
          if ((list[i - 1].rating ?? 0) < (list[i].rating ?? 0)) {
            throw new Error("testimonials not sorted by rating desc");
          }
        }
      },
    },
    {
      name: "GET /api/v1/admin/cms/testimonials/:id",
      fn: async () => {
        const token = await getAdminToken();
        const list = (await requestOk("GET", "/api/v1/admin/cms/testimonials", { token })).data as {
          _id?: string;
          name?: string;
        }[];
        const first = list[0];
        if (!first?._id) throw new Error("no testimonial id from list");
        const detail = await requestOk("GET", `/api/v1/admin/cms/testimonials/${first._id}`, { token });
        const doc = detail.data as { name?: string };
        if (doc.name !== first.name) throw new Error("GET by id name mismatch");
      },
    },
    {
      name: "POST + PUT + DELETE /api/v1/admin/cms/testimonials",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const marker = `migration-api-test-${Date.now()}`;
        const created = await requestOk("POST", "/api/v1/admin/cms/testimonials", {
          token,
          body: { name: marker, title: "before", description: "desc before", rating: 3 },
        });
        const data = created.data as { _id?: string; name?: string; description?: string };
        if (!data._id) throw new Error("create: no _id");
        if (data.name !== marker) throw new Error("create: name mismatch");
        if (data.description !== "desc before") throw new Error("create: description not persisted");

        await requestOk("PUT", `/api/v1/admin/cms/testimonials/${data._id}`, {
          token,
          body: { title: "after", description: "desc after", rating: 5 },
        });
        const updated = (await requestOk("GET", `/api/v1/admin/cms/testimonials/${data._id}`, { token }))
          .data as { title?: string; description?: string; rating?: number };
        if (updated.title !== "after") throw new Error("PUT title not persisted");
        if (updated.description !== "desc after") throw new Error("PUT description not persisted");
        if (updated.rating !== 5) throw new Error("PUT rating not persisted");

        await requestOk("DELETE", `/api/v1/admin/cms/testimonials/${data._id}`, { token });
      },
    },
  ]);
}
