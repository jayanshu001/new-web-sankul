import { beginCapture, endCapture, takeCaptured } from "./capture.js";
import { writeModuleDoc } from "./doc-writer.js";
import path from "path";

export type TestResult = {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
  skipped?: boolean;
};

export type TestFn = () => void | Promise<void>;

/**
 * Module key for the doc folder, derived from the display label.
 * "faq (admin)" / "faq (client)" → "faq".
 */
function moduleKeyFrom(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, "").trim();
}

export async function runTests(moduleName: string, tests: { name: string; fn: TestFn; skip?: boolean }[]): Promise<boolean> {
  console.log(`\n=== Migration API tests: ${moduleName} ===`);
  console.log(`Base URL: ${process.env.MIGRATION_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "4001"}`}`);

  const moduleKey = moduleKeyFrom(moduleName);
  beginCapture(moduleKey);

  const results: TestResult[] = [];
  let allOk = true;

  for (const t of tests) {
    if (t.skip) {
      results.push({ name: t.name, ok: true, ms: 0, skipped: true });
      console.log(`  ⏭️  SKIP  ${t.name}`);
      continue;
    }
    const start = Date.now();
    try {
      await t.fn();
      const ms = Date.now() - start;
      results.push({ name: t.name, ok: true, ms });
      console.log(`  ✅ PASS  ${t.name} (${ms}ms)`);
    } catch (e) {
      const ms = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ name: t.name, ok: false, ms, error: msg });
      console.log(`  ❌ FAIL  ${t.name} (${ms}ms)`);
      console.log(`         ${msg}`);
      allOk = false;
    }
  }

  endCapture();

  const ran = results.filter((r) => !r.skipped);
  const passed = ran.filter((r) => r.ok).length;
  console.log(`\n${moduleName}: ${passed}/${ran.length} passed${results.some((r) => r.skipped) ? ` (${results.filter((r) => r.skipped).length} skipped)` : ""}`);

  // On a fully-passing run, write the per-module API doc from real captures.
  // Accumulate across the admin + client suites that share a module key, so the
  // single API_DOC.md covers every endpoint of the module, not just one suite.
  const captured = takeCaptured(moduleKey);
  if (allOk && captured.length) {
    try {
      const out = writeModuleDoc(moduleKey, moduleKey, captured);
      if (out) console.log(`  📄 API doc → ${path.relative(process.cwd(), out)}`);
    } catch (e) {
      console.warn(`  (could not write API doc: ${e instanceof Error ? e.message : String(e)})`);
    }
  }

  return allOk;
}
