import { assertServerUp, getCustomerToken } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Catalog · eBook (`catalog-ebook`) — the ebook listing/detail surface.
 *
 * WIRED behind `isEbookMysql()` (flag OFF): `GET /client/ebooks` and
 * `GET /client/ebooks/:id` compose catalog-ebook (ws_ebook) + commerce-price
 * (shared price table, ebook plans) + commerce-ebook-sub (entitlement). The
 * MySQL data path is proven via tsx; these HTTP tests assert the contract holds
 * either way and add MySQL-specific assertions only when the flag is enabled.
 *
 * Both routes require a Bearer token.
 */

type EbookListItem = {
  _id?: string;
  name?: string;
  plans?: unknown[];
  isPaid?: boolean;
  isPurchased?: boolean;
  language?: string;
};

const ebookMysql = config.mysqlModules.includes("catalog-ebook");

export async function runCatalogEbookClientApiTests(): Promise<boolean> {
  let token = "";
  return runTests("catalog-ebook (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "mint customer token", fn: async () => { token = await getCustomerToken(); } },

    {
      name: "GET /api/v1/client/ebooks → { ebooks: [...] } with plans + isPaid + isPurchased",
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/ebooks", { token })).data as { ebooks: EbookListItem[] };
        if (!data || !Array.isArray(data.ebooks)) throw new Error("expected data.ebooks[]");
        for (const e of data.ebooks) {
          if (!e._id || typeof e._id !== "string") throw new Error("ebook _id must be a non-empty string");
          if (!Array.isArray(e.plans)) throw new Error("ebook missing plans[]");
          if (typeof e.isPaid !== "boolean") throw new Error("ebook missing boolean isPaid");
          if (typeof e.isPurchased !== "boolean") throw new Error("ebook missing boolean isPurchased");
        }
      },
    },
    {
      name: "[catalog-ebook ON] /ebooks serves MySQL composition (ws_ebook + shared price plans, price-derived isPaid)",
      skip: !ebookMysql,
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/ebooks", { token })).data as { ebooks: EbookListItem[] };
        if (data.ebooks.length < 1) throw new Error("expected ≥1 MySQL ebook (staging has 2)");
        // staging ebooks 18 + 45 both have active paid plans → isPaid true.
        const paid = data.ebooks.find((e) => (e.plans?.length ?? 0) > 0);
        if (!paid) throw new Error("expected an ebook with active plans (commerce-price composition)");
        if (paid.isPaid !== true) throw new Error("ebook with a >0 plan must be isPaid=true (price-derived)");
      },
    },
    {
      name: "[catalog-ebook ON] /ebooks?language=English returns empty (staging ebooks are Gujarati)",
      skip: !ebookMysql,
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/ebooks?language=English", { token })).data as { ebooks: EbookListItem[] };
        if (data.ebooks.length !== 0) throw new Error("expected 0 English ebooks in staging");
      },
    },
  ]);
}
