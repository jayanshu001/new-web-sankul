/**
 * Ground truth route dump for Express 5.
 *
 * Express 5's Layer keeps its mount path in a closure (`matchers`), so the old
 * regexp-scraping trick returns nothing. Instead we patch express.Router()/express()
 * BEFORE src/app.ts loads and record every `.use(path, router)` and `.METHOD(path)`
 * as it is registered, then reconstruct full paths from that tree.
 *
 * If a route is in this output, the server serves it. If it is not, it does not.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(new URL("../package.json", import.meta.url).pathname);
const express: any = require_("express");

const METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];
type Entry =
  | { type: "route"; method: string; path: any }
  | { type: "use"; path: any; handle: any };

const reg = new Map<any, Entry[]>();

const patch = (r: any) => {
  if (!r || reg.has(r)) return r;
  reg.set(r, []);
  for (const m of METHODS) {
    const orig = r[m]?.bind(r);
    if (!orig) continue;
    r[m] = (path: any, ...h: any[]) => {
      if (typeof path !== "function") reg.get(r)!.push({ type: "route", method: m, path });
      return orig(path, ...h);
    };
  }
  const origUse = r.use?.bind(r);
  if (origUse) {
    r.use = (...args: any[]) => {
      let p: any = "/";
      let hs = args;
      if (typeof args[0] === "string" || Array.isArray(args[0])) { p = args[0]; hs = args.slice(1); }
      for (const h of hs) if (h && reg.has(h)) reg.get(r)!.push({ type: "use", path: p, handle: h });
      return origUse(...args);
    };
  }
  return r;
};

const OrigRouter = express.Router;
express.Router = function (...a: any[]) { return patch(OrigRouter.apply(this, a)); };
Object.assign(express.Router, OrigRouter);

const origExpress = express as any;
const wrapped: any = function (...a: any[]) { return patch(origExpress.apply(this, a)); };
Object.assign(wrapped, origExpress);
require_.cache[require_.resolve("express")]!.exports = wrapped;
wrapped.Router = express.Router;

(async () => {
  const app: any = (await import(new URL("../src/app.ts", import.meta.url).pathname)).default;

  const out: Array<{ method: string; path: string }> = [];
  const join = (a: string, b: string) => {
    const s = `${a}/${b}`.replace(/\/+/g, "/");
    return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
  };

  const walk = (router: any, prefix: string, depth = 0) => {
    if (depth > 12) return;
    for (const e of reg.get(router) ?? []) {
      const paths: string[] = Array.isArray(e.path) ? e.path : [e.path ?? "/"];
      for (const p of paths) {
        if (typeof p !== "string") continue;
        if (e.type === "route") out.push({ method: e.method.toUpperCase(), path: join(prefix, p) });
        else walk(e.handle, join(prefix, p), depth + 1);
      }
    }
  };
  walk(app, "");

  const uniq = Array.from(new Map(out.map((r) => [`${r.method} ${r.path}`, r])).values())
    .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));

  fs.writeFileSync(
    new URL("../docs/postman/routes.generated.json", import.meta.url).pathname,
    JSON.stringify(uniq, null, 0)
  );
  console.error(`TOTAL ${uniq.length}`);
  console.error(`sample: ${uniq.filter((r) => r.path.includes("material")).slice(0, 6).map((r) => r.method + " " + r.path).join("\n        ")}`);
  process.exit(0);
})();
