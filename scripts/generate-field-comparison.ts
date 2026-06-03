/**
 * Generates docs/migration/FIELD_COMPARISON.md — module-by-module column/field matrix.
 * Run: yarn docs:field-comparison
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRISMA_PATH = path.join(ROOT, "prisma/schema.prisma");
const SQL_PATH = path.resolve(ROOT, "../websankul-staging/database/websankul_staging.sql");
const MODELS_DIR = path.join(ROOT, "src/models");
const OUT_PATH = path.join(ROOT, "docs/migration/FIELD_COMPARISON.md");

const MIGRATED = (process.env.MIGRATION_MYSQL_MODULES ?? "app-update,version,faq")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MIGRATED_TABLES: Record<string, string> = {
  "ws_app_update": "app-update",
  "ws_versions": "version",
  "ws_faq": "faq",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numberedTable(headers: string[], rows: string[][], start = 1): string {
  const sep = headers.map(() => "---").join("|");
  return `| # | ${headers.join(" | ")} |\n|---:|${sep}|\n${rows.map((c, i) => `| ${start + i} | ${c.join(" | ")} |`).join("\n")}`;
}

function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^_id$/, "id")
    .replace(/s$/, "")
    .replace(/_types$/, "_type");
}

function matchScore(a: string, b: string): number {
  if (a === b) return 100;
  if (normalize(a) === normalize(b)) return 90;
  if (camelToSnake(a) === b || camelToSnake(b) === a) return 85;
  if (snakeToCamel(a) === b || snakeToCamel(b) === a) return 85;
  return 0;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

type SqlColumn = { name: string; definition: string; constraints: string };

function parseSqlTables(): Map<string, SqlColumn[]> {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const tables = new Map<string, SqlColumn[]>();
  const re = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const cols: SqlColumn[] = [];
    for (const line of m[2].split("\n")) {
      const cm = line.match(/^\s*`([^`]+)`\s+(.+?)(?:,)?\s*$/);
      if (!cm) continue;
      if (["PRIMARY", "KEY", "CONSTRAINT", "UNIQUE"].some((x) => cm[1].startsWith(x))) continue;
      const def = cm[2].trim().replace(/,$/, "");
      const constraints: string[] = [];
      if (/\bNOT NULL\b/i.test(def)) constraints.push("NOT NULL");
      else constraints.push("NULL");
      const defM = def.match(/\bDEFAULT\s+([^,\s]+(?:\s+[^,]+)?)/i);
      if (defM) constraints.push(`DEFAULT ${defM[1]}`);
      const enumM = def.match(/enum\(([^)]+)\)/i);
      if (enumM) constraints.push(`enum(${enumM[1]})`);
      cols.push({
        name: cm[1],
        definition: def.replace(/\s+NOT NULL.*$/i, "").replace(/\s+DEFAULT.*$/i, "").trim(),
        constraints: constraints.join("; "),
      });
    }
    tables.set(m[1], cols);
  }

  // ALTER TABLE — PK / UNIQUE
  const alterRe = /ALTER TABLE `([^`]+)`\s+([\s\S]*?);/g;
  while ((m = alterRe.exec(sql))) {
    const table = m[1];
    const cols = tables.get(table);
    if (!cols) continue;
    const block = m[2];
    const pkM = block.match(/ADD PRIMARY KEY \(`([^`]+)`(?:,`([^`]+)`)?/);
    if (pkM) {
      for (const pk of [pkM[1], pkM[2]].filter(Boolean)) {
        const col = cols.find((c) => c.name === pk);
        if (col && !col.constraints.startsWith("PK")) col.constraints = `PK; ${col.constraints}`;
      }
    }
    const uniqRe = /ADD UNIQUE KEY[^`]*`([^`]+)`/g;
    let um: RegExpExecArray | null;
    while ((um = uniqRe.exec(block))) {
      const col = cols.find((c) => c.name === um![1]);
      if (col) col.constraints = `UNIQUE; ${col.constraints}`;
    }
    const aiM = block.match(/MODIFY `([^`]+)`[^A]*AUTO_INCREMENT/i);
    if (aiM) {
      const col = cols.find((c) => c.name === aiM[1]);
      if (col) {
        col.constraints = col.constraints.replace(/^PK; /, "");
        col.constraints = `PK AI; ${col.constraints}`.replace(/PK AI; PK AI; /, "PK AI; ");
      }
    }
  }

  return tables;
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

type PrismaField = {
  prisma: string;
  dbColumn: string;
  type: string;
  constraints: string;
};

type PrismaModel = { name: string; table: string; fields: PrismaField[] };

function parsePrismaEnums(prismaText: string): Set<string> {
  const enums = new Set<string>();
  for (const block of prismaText.split(/^enum /m).slice(1)) {
    const m = block.match(/^(\w+)/);
    if (m) enums.add(m[1]);
  }
  return enums;
}

function parsePrisma(): Map<string, PrismaModel> {
  const prisma = fs.readFileSync(PRISMA_PATH, "utf8");
  const enums = parsePrismaEnums(prisma);
  const models = new Map<string, PrismaModel>();
  const blocks = prisma.split(/^model /m).slice(1);
  for (const block of blocks) {
    const nameMatch = block.match(/^(\w+)\s*\{/);
    if (!nameMatch) continue;
    const modelName = nameMatch[1];
    const mapMatch = block.match(/@@map\("([^"]+)"\)/);
    const table = mapMatch?.[1] ?? `?_${modelName}`;
    const fields: PrismaField[] = [];
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@") || line === "}" || line.endsWith("{")) continue;
      const fm = line.match(/^(\w+)\s+(\S+)(.*)$/);
      if (!fm) continue;
      const prismaName = fm[1];
      const rawType = fm[2];
      const baseType = rawType.replace(/\?$/, "");
      const scalarTypes = /^(String|Int|Float|Boolean|DateTime|Json|Bytes|BigInt|Decimal)/;
      if (
        rawType.endsWith("[]") ||
        (/^[A-Z]/.test(baseType) && !scalarTypes.test(baseType) && !enums.has(baseType))
      ) {
        continue; // relation / composite field
      }
      const attrs = fm[3] ?? "";
      const mapCol = attrs.match(/@map\("([^"]+)"\)/)?.[1];
      const dbColumn = mapCol ?? camelToSnake(prismaName);
      const constraints: string[] = [];
      if (/@id\b/.test(attrs)) constraints.push("@id");
      if (/@unique\b/.test(attrs)) constraints.push("@unique");
      const defM = attrs.match(/@default\([\w().]+\)/);
      if (defM) constraints.push(defM[0]);
      if (/@relation/.test(attrs)) constraints.push("@relation");
      const dbType = attrs.match(/@db\.\w+(?:\([^)]*\))?/)?.[0];
      if (dbType) constraints.push(dbType);
      fields.push({
        prisma: prismaName,
        dbColumn,
        type: rawType.replace(/\?$/, "?").replace(/@.*/, ""),
        constraints: constraints.length ? constraints.join(" ") : "—",
      });
    }
    models.set(modelName, { name: modelName, table, fields });
  }
  return models;
}

// ---------------------------------------------------------------------------
// Mongoose
// ---------------------------------------------------------------------------

type MongoField = { name: string; type: string; constraints: string };

type MongoModel = {
  name: string;
  collection: string;
  file: string;
  module: string;
  fields: MongoField[];
};

function parseMongooseType(typeExpr: string): string {
  if (/Schema\.Types\.ObjectId/.test(typeExpr)) return "ObjectId";
  if (/Schema\.Types\./.test(typeExpr)) return typeExpr.replace(/.*Schema\.Types\./, "").replace(/[,\s}].*/, "");
  if (/String/.test(typeExpr)) return "String";
  if (/Number/.test(typeExpr)) return "Number";
  if (/Boolean/.test(typeExpr)) return "Boolean";
  if (/Date/.test(typeExpr)) return "Date";
  if (/\[/.test(typeExpr)) return "Array";
  return typeExpr.slice(0, 40);
}

function parseMongoose(): Map<string, MongoModel> {
  const out = new Map<string, MongoModel>();

  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".model.ts")) {
        const content = fs.readFileSync(p, "utf8");
        const rel = path.relative(ROOT, p).replace(/\\/g, "/");
        const module = rel.match(/src\/models\/([^/]+)\//)?.[1] ?? "other";
        const coll = content.match(/collection:\s*["']([^"']+)["']/)?.[1];
        const model = content.match(/model<[^>]+>\(\s*["'](\w+)["']/)?.[1] ?? ent.name.replace(".model.ts", "");
        const fields = new Map<string, MongoField>();

        for (const line of content.split("\n")) {
          const im = line.match(/^\s+(\w+)\??:\s*([^;{]+);/);
          if (im && !line.includes("extends Document")) {
            fields.set(im[1], { name: im[1], type: im[2].trim(), constraints: "—" });
          }
        }

        const schemaBlock = content.match(/new Schema[^{]*\{([\s\S]*?)\n\s*\},/);
        if (schemaBlock) {
          for (const line of schemaBlock[1].split(/\r?\n/)) {
            const fm = line.match(/^\s+(\w+):\s*\{([^{}]+)\}\s*,?\s*$/);
            if (!fm) continue;
            const body = fm[2];
            const constraints: string[] = [];
            if (/required:\s*true/.test(body)) constraints.push("required");
            if (/unique:\s*true/.test(body)) constraints.push("unique");
            if (/default:/.test(body)) constraints.push(body.match(/default:\s*([^,}]+)/)?.[1]?.trim() ?? "default");
            if (/maxlength:/.test(body)) constraints.push(`maxlength:${body.match(/maxlength:\s*(\d+)/)?.[1]}`);
            if (/min:/.test(body)) constraints.push(`min:${body.match(/min:\s*([^,}]+)/)?.[1]}`);
            if (/ref:/.test(body)) constraints.push(`ref:${body.match(/ref:\s*["']([^"']+)["']/)?.[1]}`);
            const typeM = body.match(/type:\s*([^,}]+)/);
            const type = typeM ? parseMongooseType(typeM[1]) : "—";
            fields.set(fm[1], {
              name: fm[1],
              type,
              constraints: constraints.length ? constraints.join("; ") : "—",
            });
          }
        }

        if (content.includes("timestamps: true")) {
          for (const ts of ["createdAt", "updatedAt"]) {
            if (!fields.has(ts)) fields.set(ts, { name: ts, type: "Date", constraints: "timestamps" });
          }
        }

        out.set(model, {
          name: model,
          collection: coll ?? `(default ${model.toLowerCase()}s)`,
          file: rel,
          module,
          fields: [...fields.values()],
        });
      }
    }
  };
  walk(MODELS_DIR);
  return out;
}

// ---------------------------------------------------------------------------
// Entity building
// ---------------------------------------------------------------------------

type Entity = {
  id: string;
  module: string;
  modelName: string;
  legacyTable: string | null;
  mongoCollection: string | null;
  mongoFile: string | null;
  status: string;
  fieldRows: string[][];
};

function migrationStatus(table: string | null): string {
  if (!table) return "🆕 Mongo-only";
  const mod = MIGRATED_TABLES[table];
  if (mod && MIGRATED.includes(mod)) return "✅ Migrated";
  if (table.startsWith("ws_") && !MIGRATED_TABLES[table]) return "⏳ Not migrated";
  return "⏳ Not migrated";
}

function inferModule(table: string, mongo?: MongoModel, modelName?: string): string {
  if (mongo?.module) return mongo.module;
  const t = table.replace(/^ws_/, "");
  if (t.startsWith("book")) return "book";
  if (t.startsWith("customer")) return "customer";
  if (t.startsWith("package") || t.startsWith("course") || t.startsWith("video") || t.startsWith("material") || t.startsWith("pendrive"))
    return "course";
  if (t.startsWith("exam")) return "exam";
  if (t.startsWith("ebook")) return "ebook";
  if (t.startsWith("offline")) return "offline";
  if (t.startsWith("refferal") || t.startsWith("referral")) return "referral";
  if (["migrations", "failed_jobs", "password_resets", "personal_access_tokens", "permissions", "roles", "users"].some((x) => t.includes(x)))
    return "laravel-infra";
  if (modelName && /^(AppUpdate|Version|FAQ|Banner|Testimonial|Department|Popup|ImageNotification|Terms)/.test(modelName))
    return "system";
  return "mysql-only";
}

function findMongoForTable(table: string, mongo: Map<string, MongoModel>): MongoModel | undefined {
  let best: MongoModel | undefined;
  let bestScore = 0;
  for (const m of mongo.values()) {
    const sc = matchScore(table, m.collection);
    if (sc > bestScore) {
      bestScore = sc;
      best = m;
    }
  }
  return bestScore >= 50 ? best : undefined;
}

function findPrismaForTable(table: string, prisma: Map<string, PrismaModel>): PrismaModel | undefined {
  return [...prisma.values()].find((p) => p.table === table);
}

function matchLabel(
  sqlCol: string | null,
  mongoName: string | null,
  prismaDbCol: string | null
): string {
  const hasSql = Boolean(sqlCol);
  const hasMongo = Boolean(mongoName);
  const hasPrisma = Boolean(prismaDbCol);
  const count = [hasSql, hasMongo, hasPrisma].filter(Boolean).length;
  if (count <= 1) {
    if (hasMongo && !hasSql) return "🆕 Mongo-only";
    if (hasSql && !hasMongo && !hasPrisma) return "🆕 MySQL-only";
    if (hasPrisma && !hasSql) return "🆕 Prisma-only";
    return "—";
  }
  if (hasSql && hasPrisma && sqlCol === prismaDbCol) {
    if (!hasMongo) return "✅ SQL+Prisma";
    const sc = matchScore(sqlCol!, mongoName!);
    return sc >= 85 ? "✅" : "⚠️ rename";
  }
  if (hasSql && hasMongo) {
    const sc = matchScore(sqlCol!, mongoName!);
    return sc >= 85 ? "✅" : "⚠️ rename";
  }
  return "⚠️ check";
}

function buildFieldRows(
  sqlCols: SqlColumn[] | undefined,
  prisma: PrismaModel | undefined,
  mongo: MongoModel | undefined
): string[][] {
  const rows: string[][] = [];
  const usedMongo = new Set<string>();
  const usedPrisma = new Set<string>();

  const prismaByDb = new Map<string, PrismaField>();
  for (const f of prisma?.fields ?? []) {
    prismaByDb.set(f.dbColumn, f);
    prismaByDb.set(f.prisma, f);
    prismaByDb.set(camelToSnake(f.prisma), f);
    if (f.dbColumn.includes("_")) prismaByDb.set(snakeToCamel(f.dbColumn), f);
  }
  const mongoBySnake = new Map(mongo?.fields.map((f) => [camelToSnake(f.name), f]) ?? []);

  const sqlNames = sqlCols?.map((c) => c.name) ?? [];
  const allSql = new Set(sqlNames);

  for (const sqlCol of sqlNames) {
    const sql = sqlCols?.find((c) => c.name === sqlCol);
    const pf =
      prismaByDb.get(sqlCol) ??
      prismaByDb.get(snakeToCamel(sqlCol)) ??
      prisma?.fields.find((f) => f.dbColumn === sqlCol || f.prisma === sqlCol);
    const mf =
      mongoBySnake.get(sqlCol) ??
      mongo?.fields.find((f) => matchScore(sqlCol, f.name) >= 85 || matchScore(sqlCol, camelToSnake(f.name)) >= 85);

    if (pf) usedPrisma.add(pf.prisma);
    if (mf) usedMongo.add(mf.name);

    const mysqlType = sql ? `\`${sql.definition}\`` : "—";
    const mysqlC = sql ? escapeMd(sql.constraints) : "—";
    const mongoName = mf ? `\`${mf.name}\`` : "—";
    const mongoType = mf ? mf.type : "—";
    const mongoC = mf ? escapeMd(mf.constraints) : "—";
    const prismaName = pf ? `\`${pf.prisma}\`` : "—";
    const prismaType = pf ? pf.type : "—";
    const prismaC = pf ? escapeMd(pf.constraints) : "—";
    const match = matchLabel(sqlCol, mf?.name ?? null, pf?.dbColumn ?? null);

    rows.push([
      `\`${sqlCol}\``,
      mysqlType,
      mysqlC,
      mongoName,
      mongoType,
      mongoC,
      prismaName,
      prismaType,
      prismaC,
      match,
    ]);
  }

  for (const pf of prisma?.fields ?? []) {
    if (usedPrisma.has(pf.prisma)) continue;
    if (allSql.has(pf.dbColumn)) continue;
    rows.push([
      "—",
      "—",
      "—",
      "—",
      "—",
      "—",
      `\`${pf.prisma}\``,
      pf.type,
      escapeMd(pf.constraints),
      "🆕 Prisma-only",
    ]);
  }

  for (const mf of mongo?.fields ?? []) {
    if (usedMongo.has(mf.name)) continue;
    const snake = camelToSnake(mf.name);
    if (allSql.has(snake)) continue;
    rows.push([
      allSql.has(snake) ? `\`${snake}\`` : "—",
      "—",
      "—",
      `\`${mf.name}\``,
      mf.type,
      escapeMd(mf.constraints),
      "—",
      "—",
      "—",
      "🆕 Mongo-only",
    ]);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MODULE_LABELS: Record<string, string> = {
  system: "System / CMS",
  admin: "Admin & permissions",
  customer: "Customer & auth",
  book: "Books & orders",
  course: "Courses, packages & video",
  ebook: "E-books",
  exam: "Exams & results",
  examCountdown: "Exam countdown",
  offline: "Offline centers",
  promoter: "Promoters",
  referral: "Referral program",
  testSeries: "Test series",
  educator: "Educators",
  "laravel-infra": "Laravel / infra (not in new API)",
  "mysql-only": "MySQL + Prisma only (no Mongoose)",
  other: "Other / uncategorized",
};

const MODULE_ORDER = [
  "system",
  "admin",
  "customer",
  "book",
  "course",
  "ebook",
  "exam",
  "examCountdown",
  "offline",
  "promoter",
  "referral",
  "testSeries",
  "educator",
  "mysql-only",
  "laravel-infra",
  "other",
];

function main() {
  const sqlTables = parseSqlTables();
  const prisma = parsePrisma();
  const mongo = parseMongoose();
  const entities: Entity[] = [];
  const usedMongo = new Set<string>();

  for (const [table] of [...sqlTables.entries()].sort()) {
    const p = findPrismaForTable(table, prisma);
    const m = findMongoForTable(table, mongo);
    if (m) usedMongo.add(m.name);

    const modelName = p?.name ?? m?.name ?? "—";
    const mod = inferModule(table, m, modelName);
    const fieldRows = buildFieldRows(sqlTables.get(table), p, m);

    entities.push({
      id: `${mod}-${table}`,
      module: mod,
      modelName,
      legacyTable: table,
      mongoCollection: m?.collection ?? null,
      mongoFile: m?.file ?? null,
      status: migrationStatus(table),
      fieldRows,
    });
  }

  for (const m of mongo.values()) {
    if (usedMongo.has(m.name)) continue;
    entities.push({
      id: `${m.module}-mongo-${m.name}`,
      module: m.module,
      modelName: m.name,
      legacyTable: null,
      mongoCollection: m.collection,
      mongoFile: m.file,
      status: "🆕 Mongo-only",
      fieldRows: buildFieldRows(undefined, undefined, m),
    });
  }

  const byModule = new Map<string, Entity[]>();
  for (const e of entities) {
    if (!byModule.has(e.module)) byModule.set(e.module, []);
    byModule.get(e.module)!.push(e);
  }

  const tocRows: string[][] = [];
  let sectionNum = 0;
  for (const mod of MODULE_ORDER) {
    const list = byModule.get(mod);
    if (!list?.length) continue;
    sectionNum++;
    const label = MODULE_LABELS[mod] ?? mod;
    tocRows.push([label, String(list.length), `[Jump](#module-${mod})`]);
  }

  let body = "";
  sectionNum = 0;
  for (const mod of MODULE_ORDER) {
    const list = byModule.get(mod);
    if (!list?.length) continue;
    sectionNum++;
    const label = MODULE_LABELS[mod] ?? mod;
    body += `\n<a id="module-${mod}"></a>\n\n## ${sectionNum}. ${label}\n\n`;
    body += `> Module key: \`${mod}\` — ${list.length} entit${list.length === 1 ? "y" : "ies"}\n\n`;

    let entityIdx = 0;
    for (const e of list.sort((a, b) => (a.legacyTable ?? a.modelName).localeCompare(b.legacyTable ?? b.modelName))) {
      entityIdx++;
      const mysql = e.legacyTable ? `\`${e.legacyTable}\`` : "—";
      const mongo = e.mongoCollection ? `\`${e.mongoCollection}\`` : "—";
      const prismaTable = e.legacyTable && findPrismaForTable(e.legacyTable, prisma) ? `\`${e.legacyTable}\`` : "—";

      body += `### ${sectionNum}.${entityIdx} ${e.modelName} — ${e.status}\n\n`;
      body += `| | |\n|---|---|\n`;
      body += `| **Prisma model** | ${e.modelName} |\n`;
      body += `| **Legacy MySQL** | ${mysql} |\n`;
      body += `| **MongoDB** | ${mongo} |\n`;
      body += `| **Post-migration MySQL** | ${prismaTable} |\n`;
      if (e.mongoFile) body += `| **Mongoose** | \`${e.mongoFile}\` |\n`;
      body += `\n`;

      if (e.fieldRows.length === 0) {
        body += `_No fields parsed._\n\n`;
        continue;
      }

      body +=
        numberedTable(
          [
            "Legacy MySQL column",
            "MySQL type",
            "MySQL constraints",
            "MongoDB field",
            "Mongo type",
            "Mongo constraints",
            "Prisma field",
            "Prisma type",
            "Prisma constraints",
            "Match",
          ],
          e.fieldRows
        ) + "\n\n";
    }
  }

  const md = `# Field comparison — module by module

> **Generated:** ${new Date().toISOString().slice(0, 10)} — re-run \`yarn docs:field-comparison\` after schema changes  
> **Sources:** \`websankul_staging.sql\`, \`prisma/schema.prisma\`, \`src/models/**/*.model.ts\`  
> **Related:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) (table inventory) · [legacy_system_migration_strategy.md](./legacy_system_migration_strategy.md)

---

## How to read

| Column | Meaning |
|--------|---------|
| **Legacy MySQL column** | Column name in staging dump (\`websankul_staging\`) |
| **MySQL type / constraints** | Parsed from \`CREATE TABLE\` + \`ALTER TABLE\` (PK, UNIQUE, NOT NULL, DEFAULT, enum) |
| **MongoDB field** | Mongoose schema field (camelCase) |
| **Prisma field** | Prisma model property; DB column via \`@map\` when different |
| **Match** | ✅ aligned · ⚠️ rename · 🆕 Mongo-only · 🆕 MySQL-only · 🆕 Prisma-only |

**Migrated modules (\`MIGRATION_MYSQL_MODULES\`):** \`${MIGRATED.join(", ") || "(none)"}\`

---

## Table of contents (by module)

${numberedTable(["Module", "Entities", "Jump"], tocRows)}

---

${body.trim()}

---

## Maintenance

1. Regenerate after schema changes: \`yarn docs:field-comparison\`
2. Regenerate table inventory: \`yarn docs:schema-comparison\`
3. For complex renames (e.g. Customer \`full_name\` vs \`firstName\`), add notes in [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) appendices.
`;

  fs.writeFileSync(OUT_PATH, md + "\n");
  const totalFields = entities.reduce((n, e) => n + e.fieldRows.length, 0);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  ${entities.length} entities, ${totalFields} field rows, ${sectionNum} modules`);
}

main();
