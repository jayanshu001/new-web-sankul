import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Contact = {
  mobile?: string;
  order?: number;
  active?: boolean;
  isCallAvailable?: boolean;
  isWhatsAppAvailable?: boolean;
};
type Department = {
  _id?: string;
  name?: string;
  description?: string;
  order?: number;
  active?: boolean;
  contacts?: Contact[];
};

export async function runDepartmentAdminApiTests(): Promise<boolean> {
  return runTests("department (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("department") },
    {
      name: "GET /api/v1/admin/departments (sorted order asc, nested contacts, description bridge)",
      fn: async () => {
        const token = await getAdminToken();
        const json = await requestOk("GET", "/api/v1/admin/departments", { token });
        const list = json.data as Department[];
        if (!Array.isArray(list) || list.length < 1) throw new Error("expected at least 1 department");
        // Contract: legacy `decscription` column exposed as `description`.
        if (list[0].description === undefined) throw new Error("missing description field (decscription bridge)");
        // Contract: sorted by order asc.
        for (let i = 1; i < list.length; i++) {
          if ((list[i - 1].order ?? 0) > (list[i].order ?? 0)) {
            throw new Error("departments not sorted by order asc");
          }
        }
        // Contract: contacts are nested + carry the call/whatsapp flags.
        const withContacts = list.find((d) => (d.contacts?.length ?? 0) > 0);
        if (withContacts) {
          const c = withContacts.contacts![0];
          if (!c.mobile) throw new Error("contact missing mobile");
          if (typeof c.isCallAvailable !== "boolean") throw new Error("contact missing isCallAvailable");
          if (typeof c.isWhatsAppAvailable !== "boolean") throw new Error("contact missing isWhatsAppAvailable");
        }
      },
    },
    {
      name: "POST + PUT (replace contacts) + DELETE /api/v1/admin/departments",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getAdminToken();
        const marker = `migration-api-test-${Date.now()}`;
        const created = await requestOk("POST", "/api/v1/admin/departments", {
          token,
          body: {
            name: marker,
            description: "desc before",
            order: 99,
            active: true,
            contacts: [
              { mobile: "+910000000001", order: 1, active: true, isCallAvailable: true, isWhatsAppAvailable: false },
            ],
          },
        });
        const data = created.data as Department;
        if (!data._id) throw new Error("create: no _id");
        if (data.description !== "desc before") throw new Error("create: description not persisted");
        if ((data.contacts?.length ?? 0) !== 1) throw new Error("create: contact not nested");
        if (data.contacts![0].isWhatsAppAvailable !== false) throw new Error("create: contact flag not persisted");

        // Replace contact set + scalar update.
        await requestOk("PUT", `/api/v1/admin/departments/${data._id}`, {
          token,
          body: {
            description: "desc after",
            contacts: [
              { mobile: "+910000000002", order: 1, active: true, isCallAvailable: false, isWhatsAppAvailable: true },
              { mobile: "+910000000003", order: 2, active: false, isCallAvailable: true, isWhatsAppAvailable: true },
            ],
          },
        });
        const updated = (await requestOk("GET", "/api/v1/admin/departments", { token }))
          .data as Department[];
        const mine = updated.find((d) => d._id === data._id);
        if (!mine) throw new Error("updated department not found in list");
        if (mine.description !== "desc after") throw new Error("PUT description not persisted");
        if ((mine.contacts?.length ?? 0) !== 2) throw new Error("PUT did not replace contacts (expected 2)");
        if (mine.contacts![0].mobile !== "+910000000002") throw new Error("PUT contact order/content wrong");

        await requestOk("DELETE", `/api/v1/admin/departments/${data._id}`, { token });

        // Confirm gone (and its contacts cleaned up — no orphan rows surface via API).
        const after = (await requestOk("GET", "/api/v1/admin/departments", { token })).data as Department[];
        if (after.some((d) => d._id === data._id)) throw new Error("DELETE did not remove department");
      },
    },
  ]);
}
