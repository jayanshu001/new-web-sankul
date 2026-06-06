import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Banner = {
  _id?: string;
  image?: string;
  key?: string;
  keyRef?: string;
  keyId?: unknown;
  orderBy?: number;
};

export async function runBannerSliderAdminApiTests(): Promise<boolean> {
  return runTests("banner-slider (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("banner-slider") },
    {
      name: "GET /api/v1/admin/cms/banners (sorted orderBy asc, key cased, keyId null)",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/cms/banners", { token });
        const list = json.data as Banner[];
        if (!Array.isArray(list) || list.length < 1) throw new Error("expected at least 1 banner");
        // orderBy ascending
        for (let i = 1; i < list.length; i++) {
          if ((list[i - 1].orderBy ?? 0) > (list[i].orderBy ?? 0)) {
            throw new Error("banners not sorted by orderBy asc");
          }
        }
        // Contract: MySQL lowercase key -> Mongo-cased enum + derived keyRef; keyId null.
        const withKey = list.find((b) => b.key);
        if (withKey) {
          const allowed = ["Packages", "Courses", "Book", "EBook"];
          if (!allowed.includes(withKey.key as string)) {
            throw new Error(`key not Mongo-cased: ${withKey.key}`);
          }
          if (!withKey.keyRef) throw new Error("missing derived keyRef");
          if (withKey.keyId !== null) throw new Error("keyId should be null when served from MySQL");
        }
      },
    },
    {
      name: "GET /api/v1/admin/cms/banners/:id",
      fn: async () => {
        const token = await getAdminToken();
        const list = (await requestOk("GET", "/api/v1/admin/cms/banners", { token })).data as Banner[];
        const first = list[0];
        if (!first?._id) throw new Error("no banner id from list");
        const detail = await requestOk("GET", `/api/v1/admin/cms/banners/${first._id}`, { token });
        const doc = detail.data as Banner;
        if (doc.image !== first.image) throw new Error("GET by id image mismatch");
      },
    },
    {
      name: "POST + PUT + reorder + DELETE /api/v1/admin/cms/banners",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const marker = `migration-api-test-${Date.now()}.jpg`;
        const created = await requestOk("POST", "/api/v1/admin/cms/banners", {
          token,
          body: { image: marker, key: "Packages", orderBy: 99 },
        });
        const data = created.data as Banner;
        if (!data._id) throw new Error("create: no _id");
        if (data.image !== marker) throw new Error("create: image mismatch");
        if (data.key !== "Packages") throw new Error("create: key not round-tripped to Mongo casing");
        if (data.keyRef !== "Package") throw new Error("create: keyRef not derived");

        await requestOk("PUT", `/api/v1/admin/cms/banners/${data._id}`, {
          token,
          body: { key: "Courses", orderBy: 98 },
        });
        const updated = (await requestOk("GET", `/api/v1/admin/cms/banners/${data._id}`, { token }))
          .data as Banner;
        if (updated.key !== "Courses") throw new Error("PUT key not persisted/cased");
        if (updated.keyRef !== "Course") throw new Error("PUT keyRef not derived");
        if (updated.orderBy !== 98) throw new Error("PUT orderBy not persisted");

        await requestOk("POST", "/api/v1/admin/cms/banners/reorder", {
          token,
          body: { orders: [{ id: data._id, orderBy: 50 }] },
        });
        const reordered = (await requestOk("GET", `/api/v1/admin/cms/banners/${data._id}`, { token }))
          .data as Banner;
        if (reordered.orderBy !== 50) throw new Error("reorder orderBy not applied");

        await requestOk("DELETE", `/api/v1/admin/cms/banners/${data._id}`, { token });
      },
    },
  ]);
}
