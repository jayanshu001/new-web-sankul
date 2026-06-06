import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Popup = {
  _id?: string;
  title?: string;
  image?: string;
  discount?: string;
  promocode?: string;
  promoExpireAt?: string | null;
  status?: boolean;
};

const futureISO = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export async function runPopupAdminApiTests(): Promise<boolean> {
  return runTests("popup (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("popup") },
    {
      name: "GET /api/v1/admin/cms/popups (newest first)",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/popups", { token });
        const list = json.data as Popup[];
        if (!Array.isArray(list) || list.length < 1) throw new Error("expected at least 1 popup");
        if (!list[0].title) throw new Error("popup missing title");
        // promoExpireAt should be present (date) on existing rows.
        if (list[0].promoExpireAt === undefined) throw new Error("popup missing promoExpireAt field");
      },
    },
    {
      name: "GET /api/v1/admin/cms/popups/:id",
      fn: async () => {
        const token = await getAdminToken();
        const list = (await requestOk("GET", "/api/v1/admin/cms/popups", { token })).data as Popup[];
        const first = list[0];
        if (!first?._id) throw new Error("no popup id from list");
        const detail = await requestOk("GET", `/api/v1/admin/cms/popups/${first._id}`, { token });
        if ((detail.data as Popup).title !== first.title) throw new Error("GET by id title mismatch");
      },
    },
    {
      name: "POST + PUT + DELETE /api/v1/admin/cms/popups (promoExpireAt date round-trip)",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const marker = `migration-api-test-${Date.now()}`;
        const created = await requestOk("POST", "/api/v1/admin/cms/popups", {
          token,
          body: {
            title: marker,
            description: "desc",
            image: "test-popup.jpg",
            discount: "10%",
            promocode: "TESTCODE",
            promoExpireAt: futureISO(30),
            status: true,
          },
        });
        const data = created.data as Popup;
        if (!data._id) throw new Error("create: no _id");
        if (data.title !== marker) throw new Error("create: title mismatch");
        if (!data.promoExpireAt) throw new Error("create: promoExpireAt not persisted");
        if (Number.isNaN(new Date(data.promoExpireAt).getTime())) throw new Error("create: unparseable promoExpireAt");

        await requestOk("PUT", `/api/v1/admin/cms/popups/${data._id}`, {
          token,
          body: { discount: "25%", status: false, promoExpireAt: futureISO(60) },
        });
        const updated = (await requestOk("GET", `/api/v1/admin/cms/popups/${data._id}`, { token }))
          .data as Popup;
        if (updated.discount !== "25%") throw new Error("PUT discount not persisted");
        if (updated.status !== false) throw new Error("PUT status not persisted");

        await requestOk("DELETE", `/api/v1/admin/cms/popups/${data._id}`, { token });
      },
    },
  ]);
}
