export type TestResult = {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
  skipped?: boolean;
};

export type TestFn = () => void | Promise<void>;

export async function runTests(moduleName: string, tests: { name: string; fn: TestFn; skip?: boolean }[]): Promise<boolean> {
  console.log(`\n=== Migration API tests: ${moduleName} ===`);
  console.log(`Base URL: ${process.env.MIGRATION_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "4001"}`}`);

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

  const ran = results.filter((r) => !r.skipped);
  const passed = ran.filter((r) => r.ok).length;
  console.log(`\n${moduleName}: ${passed}/${ran.length} passed${results.some((r) => r.skipped) ? ` (${results.filter((r) => r.skipped).length} skipped)` : ""}`);

  return allOk;
}
