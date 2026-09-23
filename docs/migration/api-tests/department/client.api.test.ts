import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

type Contact = { active?: boolean; order?: number };
type Department = { active?: boolean; order?: number; description?: string; contacts?: Contact[] };

export async function runDepartmentClientApiTests(): Promise<boolean> {
  return runTests("department (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("department") },
    {
      name: "GET /api/v1/client/contactus (active only, contacts active+sorted, { departments } envelope)",
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", "/api/v1/client/contactus", { token });
        const data = json.data as { departments?: Department[] };
        const list = data.departments;
        if (!Array.isArray(list) || list.length < 1) throw new Error("contactus departments empty");
        // Contract: only active departments.
        for (const d of list) {
          if (d.active === false) throw new Error("inactive department leaked into contactus");
          // description bridge present
          if (d.description === undefined) throw new Error("missing description field");
          // Contract: only active contacts, sorted by order asc.
          const contacts = d.contacts ?? [];
          for (const c of contacts) {
            if (c.active === false) throw new Error("inactive contact leaked into contactus");
          }
          for (let i = 1; i < contacts.length; i++) {
            if ((contacts[i - 1].order ?? 0) > (contacts[i].order ?? 0)) {
              throw new Error("contacts not sorted by order asc");
            }
          }
        }
        // Departments themselves sorted by order asc.
        for (let i = 1; i < list.length; i++) {
          if ((list[i - 1].order ?? 0) > (list[i].order ?? 0)) {
            throw new Error("departments not sorted by order asc");
          }
        }
      },
    },
  ]);
}
