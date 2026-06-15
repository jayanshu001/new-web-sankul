/**
 * Per-module API doc generator.
 *
 * Given the calls captured during a passing module run, write
 * docs/migration/api-tests/<moduleKey>/API_DOC.md — one section per endpoint
 * (method + path) showing real headers, request params/body, and response.
 *
 * Only invoked when a module's suite passes (see runner.ts), so the doc always
 * reflects a green, contract-correct run.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { CapturedCall } from "./capture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiTestsRoot = path.resolve(__dirname, "..");

/** Collapse numeric / ObjectId path segments to :id so calls group by endpoint. */
function endpointKey(method: string, p: string): string {
  const templated = p
    .split("/")
    .map((seg) =>
      /^[0-9]+$/.test(seg) || /^[a-f0-9]{24}$/i.test(seg) ? ":id" : seg
    )
    .join("/");
  return `${method.toUpperCase()} ${templated}`;
}

function fence(lang: string, value: unknown): string {
  const body =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return "```" + lang + "\n" + body + "\n```";
}

/**
 * Keep docs readable: if a response body's `data` is a long array, show the
 * first 2 items + a count note instead of dumping hundreds of rows.
 */
function sample(value: unknown, max = 4000): unknown {
  const s = JSON.stringify(value);
  if (!s || s.length <= max) return value;

  if (value && typeof value === "object" && Array.isArray((value as any).data)) {
    const arr = (value as any).data as unknown[];
    return {
      ...(value as Record<string, unknown>),
      data: arr.slice(0, 2),
      _note: `array truncated for docs — ${arr.length} items total; first 2 shown`,
    };
  }
  return { _note: `response truncated for docs — ${s.length} chars`, preview: s.slice(0, 1500) + "…" };
}

/**
 * Accumulate this run's calls with any already captured for the module (so the
 * admin + client suites both contribute to one API_DOC.md), via a sidecar JSON.
 */
/** Per-process set of module dirs whose sidecar has been reset this run. */
const freshThisProcess = new Set<string>();

function accumulate(outDir: string, calls: CapturedCall[]): CapturedCall[] {
  const sidecar = path.join(outDir, ".api-doc-calls.json");
  let prior: CapturedCall[] = [];
  // First time we touch this module in this process, start fresh (drop any
  // sidecar left over from a previous run); thereafter accumulate (admin+client).
  if (freshThisProcess.has(outDir)) {
    try {
      prior = JSON.parse(fs.readFileSync(sidecar, "utf8")) as CapturedCall[];
    } catch {
      /* none yet */
    }
  } else {
    freshThisProcess.add(outDir);
  }
  const all = [...prior, ...calls];
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(sidecar, JSON.stringify(all), "utf8");
  return all;
}

export function writeModuleDoc(
  moduleKey: string,
  moduleLabel: string,
  rawCalls: CapturedCall[]
): string | null {
  if (!rawCalls.length) return null;

  const outDir = path.join(apiTestsRoot, moduleKey);
  const calls = accumulate(outDir, rawCalls);

  // Group calls by templated endpoint; keep the first example of each.
  const groups = new Map<string, CapturedCall[]>();
  for (const c of calls) {
    const key = endpointKey(c.method, c.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const lines: string[] = [];
  lines.push(`# ${moduleLabel} — API reference`);
  lines.push("");
  lines.push(
    `> Auto-generated from a passing \`migration:api\` run for **${moduleKey}**.`
  );
  lines.push(
    `> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.`
  );
  lines.push("");
  lines.push(`**Endpoints covered:** ${groups.size}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const [key, examples] of groups) {
    const ex = examples[0];
    lines.push(`## ${key}`);
    lines.push("");

    lines.push("### Request headers");
    lines.push(fence("json", ex.requestHeaders));
    lines.push("");

    if (ex.query && Object.keys(ex.query).length) {
      lines.push("### Query parameters");
      lines.push(fence("json", ex.query));
      lines.push("");
    }

    if (ex.requestBody !== undefined) {
      lines.push("### Request body");
      lines.push(fence("json", ex.requestBody));
      lines.push("");
    }

    lines.push(`### Response (\`${ex.responseStatus}\`)`);
    lines.push(fence("json", sample(ex.responseBody)));
    lines.push("");

    if (examples.length > 1) {
      lines.push(`_(${examples.length} calls captured for this endpoint; first shown.)_`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "API_DOC.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  return outPath;
}
