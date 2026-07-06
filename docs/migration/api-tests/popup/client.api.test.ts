import { config } from "../_lib/env.js";
import { getAdminToken, getCustomerToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Popup = { _id?: string; title?: string; status?: boolean; promoExpireAt?: string | null };

const dateISO = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export async function runPopupClientApiTests(): Promise<boolean> {
  return runTests("popup (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("popup") },
    {
      name: "GET /api/v1/client/popup → single active popup or null (not array)",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/popup", { token });
        const data = json.data as Popup | null;
        if (Array.isArray(data)) throw new Error("client popup must be a single object or null, not an array");
        if (data) {
          if (data.status === false) throw new Error("inactive popup returned as active");
          if (!data.promoExpireAt) throw new Error("active popup missing promoExpireAt");
          if (new Date(data.promoExpireAt).getTime() <= Date.now()) {
            throw new Error("expired popup returned as active");
          }
        }
      },
    },
    {
      name: "active popup honors status + expiry (write-gated cross-check)",
      skip: config.skipWrite,
      fn: async () => {
        const adminToken = await getAdminToken();
        const custToken = await getCustomerToken();
        const base = {
          description: "d",
          image: "x.jpg",
          discount: "5%",
          promocode: "POPUPTEST",
        };
        // (a) future + active → should be the returned active popup (newest first).
        const activeMarker = `popup-active-${Date.now()}`;
        const active = await requestOk("POST", "/api/v1/admin/cms/popups", {
          token: adminToken,
          body: { ...base, title: activeMarker, promoExpireAt: dateISO(30), status: true },
        });
        // (b) future but INACTIVE → must never surface.
        const inactiveMarker = `popup-inactive-${Date.now()}`;
        const inactive = await requestOk("POST", "/api/v1/admin/cms/popups", {
          token: adminToken,
          body: { ...base, title: inactiveMarker, promoExpireAt: dateISO(30), status: false },
        });
        // (c) active but EXPIRED → must never surface.
        const expiredMarker = `popup-expired-${Date.now()}`;
        const expired = await requestOk("POST", "/api/v1/admin/cms/popups", {
          token: adminToken,
          body: { ...base, title: expiredMarker, promoExpireAt: dateISO(-5), status: true },
        });

        const ids = [active, inactive, expired].map((r) => (r.data as Popup)._id!);
        try {
          const got = (await requestOk("GET", "/api/v1/client/popup", { token: custToken }))
            .data as Popup | null;
          if (!got) throw new Error("expected an active popup to be returned");
          // Newest active+future row wins; the inactive/expired ones must not be it.
          if (got.title === inactiveMarker) throw new Error("inactive popup surfaced as active");
          if (got.title === expiredMarker) throw new Error("expired popup surfaced as active");
        } finally {
          for (const id of ids) {
            await requestOk("DELETE", `/api/v1/admin/cms/popups/${id}`, { token: adminToken });
          }
        }
      },
    },
  ]);
}
