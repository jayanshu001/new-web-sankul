import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

export async function runTestimonialClientApiTests(): Promise<boolean> {
  return runTests("testimonial (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("testimonial") },
    {
      name: "GET /api/v1/client/testimonials",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/testimonials", { token });
        const list = json.data as { description?: string; rating?: number }[];
        if (!Array.isArray(list) || list.length < 1) throw new Error("client testimonials empty");
        if (list[0].description === undefined) throw new Error("missing description field (discription bridge)");
        for (let i = 1; i < list.length; i++) {
          if ((list[i - 1].rating ?? 0) < (list[i].rating ?? 0)) {
            throw new Error("testimonials not sorted by rating desc");
          }
        }
      },
    },
  ]);
}
