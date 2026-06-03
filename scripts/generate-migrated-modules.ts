/**
 * Generates docs/migration/MIGRATED_MODULES.md — only modules on MySQL (Phase 2+).
 * Run: yarn docs:migrated-modules
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "docs/migration/MIGRATED_MODULES.md");

/** Modules with Prisma repository + service + transformer wired. Add here when a module ships. */
const MIGRATED_REGISTRY = [
  {
    key: "app-update",
    label: "App Update",
    phase: 2,
    migratedOn: "2026-06-04",
    prismaModel: "AppUpdate",
    mysqlTable: "ws_app_update",
    mongoCollection: "ws_app_updates",
    code: "src/modules/app-update",
    adminRoutes: "GET/PUT `/api/v1/admin/cms/app-update`",
    clientRoutes: "Used by `checkUpgrade` (client CMS)",
    testScript: "yarn db:test-cms-pilot",
    rowCountHint: "Singleton row `id = 1`",
    transformerNotes: [
      "MySQL column `isUpdateAvailble` (legacy typo) → API `isUpdateAvailable`",
      "Mongo collection `ws_app_updates` (plural) → MySQL `ws_app_update` (singular)",
    ],
  },
  {
    key: "version",
    label: "Version",
    phase: 2,
    migratedOn: "2026-06-04",
    prismaModel: "Version",
    mysqlTable: "ws_versions",
    mongoCollection: "ws_versions",
    code: "src/modules/version",
    adminRoutes: "GET/PUT `/api/v1/admin/cms/version`",
    clientRoutes: "GET `/api/v1/client/version`, `checkUpgrade`",
    testScript: "yarn db:test-cms-pilot",
    rowCountHint: "Singleton row `id = 1`",
    transformerNotes: ["Table/collection name matches (`ws_versions`)"],
  },
  {
    key: "faq",
    label: "FAQ",
    phase: 2,
    migratedOn: "2026-06-04",
    prismaModel: "FAQ",
    mysqlTable: "ws_faq",
    mongoCollection: "ws_faqs",
    code: "src/modules/faq",
    adminRoutes: "CRUD `/api/v1/admin/cms/faqs` (+ faq-types when on Mongo)",
    clientRoutes: "GET `/api/v1/client/faqs`, GET `/api/v1/client/faq-types`",
    testScript: "yarn db:test-faq",
    rowCountHint: "13 rows in staging (5 general, 8 referral)",
    transformerNotes: [
      "MySQL `type` enum (`general` | `referral`) — no `ws_faq_types` table",
      "API exposes synthetic `typeId` for admin/client compat with Mongo-era contract",
      "Admin write body uses `type` on MySQL (not Mongo `typeId`)",
      "Mongo collection `ws_faqs` → MySQL `ws_faq`",
    ],
  },
] as const;

function numberedTable(headers: string[], rows: string[][], start = 1): string {
  const sep = headers.map(() => "---").join("|");
  return `| # | ${headers.join(" | ")} |\n|---:|${sep}|\n${rows.map((c, i) => `| ${start + i} | ${c.join(" | ")} |`).join("\n")}`;
}

function main() {
  const envActive = (process.env.MIGRATION_MYSQL_MODULES ?? MIGRATED_REGISTRY.map((m) => m.key).join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const modules = MIGRATED_REGISTRY.filter((m) => envActive.includes(m.key));
  const registryKeys = MIGRATED_REGISTRY.map((m) => m.key).join(",");

  const summaryRows = MIGRATED_REGISTRY.map((m) => [
    `\`${m.key}\``,
    m.label,
    `\`${m.mysqlTable}\``,
    `\`${m.mongoCollection}\``,
    envActive.includes(m.key) ? "✅ enabled" : "⏸ not in env",
    `[Detail](#${m.key})`,
  ]);

  let sections = "";
  let n = 0;
  for (const m of MIGRATED_REGISTRY) {
    n++;
    const enabled = envActive.includes(m.key);
    sections += `\n## ${n}. ${m.label} {#${m.key}}\n\n`;
    sections += `| | |\n|---|---|\n`;
    sections += `| **Module key** | \`${m.key}\` |\n`;
    sections += `| **Phase** | ${m.phase} |\n`;
    sections += `| **Migrated** | ${m.migratedOn} |\n`;
    sections += `| **Status** | ${enabled ? "✅ Active when listed in `MIGRATION_MYSQL_MODULES`" : "⏸ Implemented; add \`${m.key}\` to env to enable"} |\n`;
    sections += `| **Prisma model** | \`${m.prismaModel}\` |\n`;
    sections += `| **MySQL table** | \`${m.mysqlTable}\` |\n`;
    sections += `| **Mongo collection (legacy app)** | \`${m.mongoCollection}\` |\n`;
    sections += `| **Code** | \`${m.code}/\` |\n`;
    sections += `| **Data** | ${m.rowCountHint} |\n`;
    sections += `| **Smoke test** | \`${m.testScript}\` |\n`;
    sections += `| **Admin API** | ${m.adminRoutes} |\n`;
    sections += `| **Client API** | ${m.clientRoutes} |\n`;
    sections += `\n**Transformer / schema notes:**\n\n`;
    for (const note of m.transformerNotes) {
      sections += `- ${note}\n`;
    }
    sections += `\n**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for \`${m.prismaModel}\`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)\n`;
  }

  const md = `# Migrated modules (MySQL / Prisma)

> **Generated:** ${new Date().toISOString().slice(0, 10)} — re-run \`yarn docs:migrated-modules\` when you add a module  
> **Scope:** Only modules with **repository → service → transformer** on **legacy MySQL** tables  
> **Enable in runtime:** \`MIGRATION_MYSQL_MODULES\` in \`.env\`

---

## Summary

| | |
|---|---|
| **Total migrated (code complete)** | ${MIGRATED_REGISTRY.length} |
| **Active in env** (this generation) | \`${envActive.join(", ") || "(none)"}\` |
| **Full registry keys** | \`${registryKeys}\` |

${numberedTable(
  ["Module key", "Label", "MySQL table", "Mongo collection", "Env", "Detail"],
  summaryRows
)}

---

## Environment

\`\`\`env
DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
MIGRATION_MYSQL_MODULES=${registryKeys}
\`\`\`

- Toggle: \`src/config/migration.ts\` → \`isMysqlModule("<key>")\`
- Prisma connects at boot when \`MIGRATION_MYSQL_MODULES\` is non-empty (\`src/index.ts\`)
- Unlisted modules still use **MongoDB** (Mongoose)

---

## Module details
${sections}
---

## Adding the next module

1. Implement \`src/modules/<name>/\` (repository, service, transformer).
2. Wire controllers with \`isMysqlModule("<key>")\`.
3. Add an entry to \`MIGRATED_REGISTRY\` in \`scripts/generate-migrated-modules.ts\`.
4. Run \`yarn docs:migrated-modules\`, \`yarn docs:schema-comparison\`, \`yarn docs:field-comparison\`.
5. Log tests in [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md) before expanding \`MIGRATION_MYSQL_MODULES\`.

---

## Related docs

| Document | Purpose |
|----------|---------|
| [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md) | Build progress & changelog |
| [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md) | Pass/Fail test checklist |
| [testing-guide.md](./testing-guide.md) | How to validate each module |
| [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) | All tables — inventory |
| [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) | All modules — column/field matrix |
| [MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md) | What to update after each change |
`;

  fs.writeFileSync(OUT_PATH, md + "\n");
  console.log(`Wrote ${OUT_PATH} (${MIGRATED_REGISTRY.length} modules)`);
}

main();
