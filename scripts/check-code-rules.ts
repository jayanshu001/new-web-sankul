/**
 * Guard for the CODE_QUALITY_AUDIT rules that have no linter here (the repo has no ESLint).
 * Fails (exit 1) on a new violation; the `any` rule is a ratchet against today's count, so
 * lower ANY_BASELINE whenever a cleanup brings the number down.
 * Run: yarn check:rules
 */
import fs from "fs";
import path from "path";

const ANY_BASELINE = 1817;
// The BullMQ notification scheduler still lives under admin/ (moving it needs sign-off).
const LAYER_ALLOWLIST = new Set(["src/modules/client-live-reminder/client-live-reminder.service.ts"]);

const files: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".ts")) files.push(p);
  }
};
walk("src");

const problems: string[] = [];
let anyCount = 0;
const stripStrings = (l: string) => l.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');

for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    anyCount += (line.match(/:\s*any\b|as any\b|<any>|any\[\]/g) ?? []).length;

    // CQ0.2: "fetch everything, filter in memory".
    if (/\b(limit|take):\s*100000\b/.test(line)) problems.push(`${at} limit/take 100000 (filter in SQL instead)`);

    // CQ0.1: never log an OTP value (message text mentioning "otp", and `!!otp`, are fine).
    if (/\b(console|logger)\.\w+\(/.test(line) && (/\$\{\s*otp\b/.test(line) || /(?<!!!)\botp\b/.test(stripStrings(line)))) {
      problems.push(`${at} OTP value passed to a log call`);
    }

    // CQ1.7 / CQ2.6: modules/ must not depend on the HTTP layers.
    if (f.startsWith("src/modules/") && !LAYER_ALLOWLIST.has(f) && /from "(\.\.\/)+(admin|client|educator|promoter)\//.test(line)) {
      problems.push(`${at} modules/ imports an HTTP layer`);
    }
  });
}

if (anyCount > ANY_BASELINE) problems.push(`\`any\` count ${anyCount} > baseline ${ANY_BASELINE} (type the new code)`);

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} rule violation(s).`);
  process.exit(1);
}
console.log(`check:rules OK (${files.length} files, any=${anyCount}/${ANY_BASELINE}).`);
