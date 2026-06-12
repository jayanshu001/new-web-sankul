import { assertServerUp } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Offline · Center/Batch (`offline-batch`) — browse reads. WIRED behind
 * `isOfflineBatchMysql()` (flag OFF): GET /client/offline/{centers,batches} and
 * /{centers,batches}/:id from ws_offline_center + ws_offline_batch (+ city).
 * The offline browse routes are PUBLIC (no auth). MySQL data path proven via tsx.
 *
 * SCOPE: getOfflineDashboard stays on Mongo (reads the unmigrated
 * OfflineBannerSlider); submitEnquiry is a WRITE path (not built).
 */

const offlineMysql = config.mysqlModules.includes("offline-batch");

export async function runOfflineBatchClientApiTests(): Promise<boolean> {
  return runTests("offline-batch (client)", [
    { name: "server healthz", fn: assertServerUp },

    {
      name: "GET /offline/centers → array of centers (contract holds either path)",
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/offline/centers")).data as any[];
        if (!Array.isArray(data)) throw new Error("expected an array of centers");
      },
    },
    {
      name: "GET /offline/batches → array of batches",
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/offline/batches")).data as any[];
        if (!Array.isArray(data)) throw new Error("expected an array of batches");
      },
    },
    {
      name: "[offline-batch ON] /offline/centers serves MySQL (phone string, images[], city ref, status synth)",
      skip: !offlineMysql,
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/offline/centers")).data as any[];
        if (data.length !== 3) throw new Error(`expected 3 MySQL centers, got ${data.length}`);
        for (const c of data) {
          if (typeof c.phone !== "string") throw new Error("center phone must be a string (bigint → string)");
          if (!Array.isArray(c.images)) throw new Error("center images must be an array (from JSON column)");
          if (c.status !== true) throw new Error("center status must be synthesized true");
        }
      },
    },
    {
      name: "[offline-batch ON] /offline/batches serves MySQL (center→city populated, description from `discription`)",
      skip: !offlineMysql,
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/offline/batches")).data as any[];
        if (data.length !== 3) throw new Error(`expected 3 MySQL batches, got ${data.length}`);
        for (const b of data) {
          if (typeof b.description !== "string") throw new Error("batch description (from `discription`) missing");
          if (b.center && typeof b.center !== "object") throw new Error("batch center should be populated");
        }
      },
    },
  ]);
}
