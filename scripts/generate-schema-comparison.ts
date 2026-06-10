/**
 * Generates docs/migration/SCHEMA_COMPARISON.md
 * Run: yarn docs:schema-comparison
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// Load .env so MIGRATION_MYSQL_MODULES drives the "✅ Migrated" status without
// needing the var set inline on every run.
dotenv.config({ path: path.join(ROOT, ".env") });
const PRISMA = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const SQL = fs.readFileSync(
  path.resolve(ROOT, "../websankul-staging/database/websankul_staging.sql"),
  "utf8"
);
const MODELS_DIR = path.join(ROOT, "src/models");

const MIGRATED = (process.env.MIGRATION_MYSQL_MODULES ?? "app-update,version,faq")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Markdown table with a leading # column (1-based row index). */
function numberedTable(headers: string[], rows: string[][], start = 1): string {
  const sep = headers.map(() => "---").join("|");
  const headerRow = `| # | ${headers.join(" | ")} |`;
  const sepRow = `|---:|${sep}|`;
  const body = rows.map((cells, i) => `| ${start + i} | ${cells.join(" | ")} |`).join("\n");
  return `${headerRow}\n${sepRow}\n${body}`;
}

/** Prisma models → MySQL table + fields */
function parsePrisma(): Map<
  string,
  { table: string; fields: { name: string; prisma: string; db?: string }[] }
> {
  const models = new Map<string, { table: string; fields: { name: string; prisma: string; db?: string }[] }>();
  const blocks = PRISMA.split(/^model /m).slice(1);
  for (const block of blocks) {
    const nameMatch = block.match(/^(\w+)\s*\{/);
    if (!nameMatch) continue;
    const modelName = nameMatch[1];
    const mapMatch = block.match(/@@map\("([^"]+)"\)/);
    const table = mapMatch?.[1] ?? `?_${modelName}`;
    const fields: { name: string; prisma: string; db?: string }[] = [];
    for (const line of block.split("\n")) {
      const fm = line.match(/^\s+(\w+)\s+(.+?)\s*(@map\("([^"]+)"\))?/);
      if (!fm || fm[1] === "@@map" || fm[1].startsWith("@@")) continue;
      if (["//", "}"].some((x) => fm[1].includes(x))) continue;
      fields.push({
        name: fm[4] ?? fm[1],
        prisma: fm[1],
        db: fm[4],
      });
    }
    models.set(modelName, { table, fields });
  }
  return models;
}

/** Mongoose collections from src/models */
function parseMongoose(): Map<string, { collection: string; file: string; fields: string[] }> {
  const out = new Map<string, { collection: string; file: string; fields: string[] }>();
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".model.ts")) {
        const content = fs.readFileSync(p, "utf8");
        const coll = content.match(/collection:\s*["']([^"']+)["']/);
        const model = content.match(/model<[^>]+>\(\s*["'](\w+)["']/);
        const name = model?.[1] ?? ent.name.replace(".model.ts", "");
        const fields: string[] = [];
        const schemaBlock = content.match(/new Schema[^{]*\{([\s\S]*?)\n\s*\}/);
        if (schemaBlock) {
          for (const line of schemaBlock[1].split("\n")) {
            const m = line.match(/^\s+(\w+):\s*\{/);
            if (m) fields.push(m[1]);
          }
        }
        out.set(name, {
          collection: coll?.[1] ?? `(default ${name.toLowerCase()}s)`,
          file: path.relative(ROOT, p).replace(/\\/g, "/"),
          fields,
        });
      }
    }
  };
  walk(MODELS_DIR);
  return out;
}

function parseSqlTables(): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const re = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) {
    const cols: string[] = [];
    for (const line of m[2].split("\n")) {
      const cm = line.match(/^\s*`([^`]+)`/);
      if (cm && !cm[1].startsWith("PRIMARY") && !cm[1].startsWith("KEY") && !cm[1].startsWith("CONSTRAINT")) {
        cols.push(cm[1]);
      }
    }
    tables.set(m[1], cols);
  }
  return tables;
}

const normalize = (t: string) =>
  t
    .replace(/_types$/, "_type")
    .replace(/_types$/, "")
    .replace(/s$/, "")
    .replace(/_slider$/, "_slider")
    .replace(/_images$/, "_image")
    .replace(/_notifications$/, "_notification")
    .replace(/_updates$/, "_update")
    .replace(/_faqs$/, "_faq")
    .replace(/_customers$/, "_customer")
    .replace(/_packages$/, "_package")
    .replace(/_books$/, "_book")
    .replace(/_orders$/, "_order");

function matchScore(a: string, b: string): number {
  if (a === b) return 100;
  if (normalize(a) === normalize(b)) return 90;
  if (a.includes(b) || b.includes(a)) return 50;
  return 0;
}

function main() {
  const prisma = parsePrisma();
  const mongo = parseMongoose();
  const sqlTables = parseSqlTables();

  const prismaByTable = new Map<string, string>();
  for (const [model, { table }] of prisma) prismaByTable.set(table, model);

  type Row = {
    domain: string;
    legacyMysql: string;
    mongoCollection: string;
    migrationMysql: string;
    status: string;
    notes: string;
  };
  const rows: Row[] = [];

  const usedMongo = new Set<string>();
  const usedPrisma = new Set<string>();

  for (const [table, sqlCols] of [...sqlTables.entries()].sort()) {
    const prismaModel = [...prisma.entries()].find(([, v]) => v.table === table);
    let mongoMatch: [string, (typeof mongo extends Map<string, infer V> ? V : never)] | undefined;
    let best = 0;
    for (const [mName, mVal] of mongo) {
      const sc = matchScore(table, mVal.collection);
      if (sc > best) {
        best = sc;
        mongoMatch = [mName, mVal];
      }
    }

    const pModel = prismaModel?.[0];
    const pTable = table;
    const mColl = mongoMatch && best >= 50 ? mongoMatch[1].collection : "—";
    const mName = mongoMatch && best >= 50 ? mongoMatch[0] : "—";

    if (mongoMatch && best >= 50) usedMongo.add(mongoMatch[0]);
    if (pModel) usedPrisma.add(pModel);

    let status = "⏳ Not migrated";
    const modKey = pModel?.replace(/([A-Z])/g, (x) => x.toLowerCase()).replace(/^./, (c) => c) ?? "";
    if (table === "ws_app_update" && MIGRATED.includes("app-update")) status = "✅ Migrated";
    if (table === "ws_versions" && MIGRATED.includes("version")) status = "✅ Migrated";
    if (table === "ws_faq" && MIGRATED.includes("faq")) status = "✅ Migrated";
    if (table === "ws_banner_slider" && MIGRATED.includes("banner-slider")) status = "✅ Migrated";
    if (table === "ws_testimonial" && MIGRATED.includes("testimonial")) status = "✅ Migrated";
    if (
      (table === "ws_department" || table === "ws_department_contact") &&
      MIGRATED.includes("department")
    )
      status = "✅ Migrated";
    if (table === "ws_termsandcondition" && MIGRATED.includes("terms")) status = "✅ Migrated";
    if (table === "ws_popup_notification" && MIGRATED.includes("popup")) status = "✅ Migrated";
    if (
      (table === "ws_customer" ||
        table === "ws_customer_otp" ||
        table === "ws_customer_access_token") &&
      MIGRATED.includes("customer-auth")
    )
      status = "✅ Migrated";
    if (
      (table === "ws_customer_state" ||
        table === "ws_customer_distict" ||
        table === "ws_customer_education" ||
        table === "ws_customer_target_goal") &&
      MIGRATED.includes("customer-lookups")
    )
      status = "✅ Migrated";
    // customer-profile reuses ws_customer (already migrated by customer-auth).
    // address & bank-account code is complete but flags stay OFF (cross-module deps);
    // mark "🟡 Code ready" so the table reflects build state without claiming live.
    if (table === "ws_customer_address")
      status = MIGRATED.includes("customer-address") ? "✅ Migrated" : "🟡 Code ready (flag off)";
    if (table === "ws_customer_bank_account")
      status = MIGRATED.includes("customer-bank-account") ? "✅ Migrated" : "🟡 Code ready (flag off)";
    if (table === "ws_customer_shipping") status = "🟡 Prisma ready (part of cart/order)";
    if (table === "ws_offline_city" && MIGRATED.includes("offline-city")) status = "✅ Migrated";

    let notes = "";
    if (mColl !== "—" && mColl !== table && best < 100) notes = "Collection name differs from MySQL table";
    if (!prismaModel) notes = "In SQL dump but no Prisma model";
    if (prismaModel && mColl === "—") notes = "MySQL/Prisma only (no Mongoose model found)";

    rows.push({
      domain: pModel ?? mName,
      legacyMysql: `\`${table}\` (${sqlCols.length} cols)`,
      mongoCollection: mColl === "—" ? "—" : `\`${mColl}\``,
      migrationMysql: prismaModel ? `\`${pTable}\`` : "—",
      status,
      notes,
    });
  }

  // Mongo-only
  for (const [mName, mVal] of mongo) {
    if (usedMongo.has(mName)) continue;
    rows.push({
      domain: mName,
      legacyMysql: "—",
      mongoCollection: `\`${mVal.collection}\``,
      migrationMysql: "— (new feature / Mongo-only)",
      status: "🆕 Mongo-only",
      notes: `See ${mVal.file}`,
    });
  }

  const detailModels = [
    { key: "app-update", prisma: "AppUpdate", mongo: "AppUpdate" },
    { key: "version", prisma: "Version", mongo: "Version" },
    { key: "faq", prisma: "FAQ", mongo: "FAQ" },
    { key: "banner-slider", prisma: "BannerSlider", mongo: "BannerSlider" },
    { key: "testimonial", prisma: "Testimonial", mongo: "Testimonial" },
    { key: "department", prisma: "Department", mongo: "Department" },
    { key: "terms", prisma: "TermsAndConditions", mongo: "TermsAndConditions" },
    { key: "popup", prisma: "PopupNotifications", mongo: "PopupNotification" },
  ];

  let detailMd = "";
  for (const d of detailModels) {
    const p = [...prisma.entries()].find(([n]) => n === d.prisma)?.[1];
    const m = mongo.get(d.mongo);
    const table = p?.table;
    const sqlCols = table ? sqlTables.get(table) : undefined;
    if (!p || !table) continue;

    detailMd += `\n### ${d.prisma} (\`${table}\`) — ${MIGRATED.includes(d.key) ? "✅ Migrated" : "⏳"}\n\n`;

    const detailRows: string[][] = [];
    const mongoFields = new Set(m?.fields ?? []);
    for (const f of p.fields) {
      const sqlCol = f.db ?? f.name;
      const inSql = sqlCols?.includes(sqlCol) ? "✓" : "—";
      const mongoField =
        [...mongoFields].find((mf) => mf.toLowerCase().includes(f.prisma.toLowerCase().slice(0, 4))) ??
        (d.key === "faq" && f.prisma === "type"
          ? "typeId (ObjectId ref)"
          : d.key === "faq" && f.prisma === "is_expand"
            ? "—"
            : "—");
      detailRows.push([
        `\`${sqlCol}\` ${inSql === "✓" ? "" : "(prisma only)"}`,
        mongoField,
        `\`${f.prisma}\` → \`${sqlCol}\``,
        "PK/FK per dump",
      ]);
    }
    if (d.key === "faq") {
      detailRows.push(["—", "`typeId` (ObjectId)", "—", "Mongo only; MySQL uses enum `type`"]);
      detailRows.push(["—", "`ws_faq_types` collection", "—", "Mongo only; no legacy table"]);
    }
    detailMd += numberedTable(
      ["Legacy MySQL column", "MongoDB field", "Post-migration (Prisma)", "Constraints / notes"],
      detailRows
    );
    detailMd += "\n";
    if (m?.collection && m.collection !== table) {
      detailMd += `\n**Naming:** Mongo \`${m.collection}\` → migration target \`${table}\`.\n`;
    }
  }

  const md = `# Schema comparison — Legacy MySQL vs MongoDB vs post-migration MySQL

> **Generated:** ${new Date().toISOString().slice(0, 10)} (re-run \`yarn docs:schema-comparison\` after schema changes)  
> **Migrated only:** [MIGRATED_MODULES.md](./MIGRATED_MODULES.md) · **Field-level detail:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md)  
> **Sources:** \`websankul_staging.sql\`, \`prisma/schema.prisma\`, \`src/models/**/*.model.ts\`  
> **Strategy:** [legacy_system_migration_strategy.md](./legacy_system_migration_strategy.md)

---

## How to read this document

| Column | Meaning |
|--------|---------|
| **Legacy MySQL** | Production/staging table from Laravel + old API (\`websankul-api-staging\`) |
| **MongoDB collection** | Current \`new-web-sankul\` Mongoose storage (intermediate rewrite) |
| **Post-migration MySQL** | Target table used by Prisma after Phase 2+ (usually **same name** as legacy) |
| **Status** | Whether the module already reads/writes MySQL via \`MIGRATION_MYSQL_MODULES\` |

### Common patterns

| Pattern | Example | Migration note |
|---------|---------|----------------|
| Singular vs plural table | \`ws_faq\` vs \`ws_faqs\` | Prisma maps to **legacy singular** table |
| Int PK vs ObjectId | \`id\` int vs \`_id\` ObjectId | API transformers expose \`_id\` as string for admin |
| Typo preserved | \`isUpdateAvailble\`, \`ws_refferal_*\` | Keep column names; fix in API layer only |
| MySQL enum vs Mongo ref | \`ws_faq.type\` enum vs \`typeId\` ObjectId | Transformer + validation per module |
| Mongo-only feature | \`ws_live_courses\`, \`ws_test_series\` | Needs new MySQL tables or stay on Mongo until designed |

### Currently migrated modules (\`MIGRATION_MYSQL_MODULES\`)

\`${MIGRATED.join(", ")}\`

---

## Master inventory (table / collection)

${numberedTable(
  [
    "Domain (model)",
    "Legacy MySQL (staging dump)",
    "MongoDB collection (new app)",
    "Post-migration MySQL (Prisma)",
    "Status",
    "Notes",
  ],
  rows.map((r) => [
    r.domain,
    r.legacyMysql,
    r.mongoCollection,
    r.migrationMysql,
    r.status,
    r.notes,
  ])
)}

---

## Column-level detail (migrated modules)
${detailMd}

---

## Laravel / infra tables (usually not ported to new API)

These exist in the staging dump but are not Mongoose models in \`new-web-sankul\`:

${numberedTable(
  ["Table", "Purpose"],
  [
    ["`ws_migrations`", "Laravel migrations history"],
    ["`ws_failed_jobs`", "Laravel queue"],
    ["`ws_password_resets`", "Laravel auth"],
    ["`ws_personal_access_tokens`", "Laravel Sanctum"],
    [
      "`ws_permissions`, `ws_roles`, `ws_role_has_permissions`, `ws_model_has_*`",
      "Spatie permissions (Laravel admin)",
    ],
    [
      "`ws_users`",
      "Laravel admin users (legacy); new app uses `ws_users` Mongo collection for AdminUser",
    ],
  ]
)}

New app permission system uses Mongo collections \`ws_permissions\`, \`ws_roles\`, etc. — **separate design** from Laravel Spatie tables.

---

## Mongo-only collections (no matching legacy \`ws_*\` table in dump)

High-priority examples to plan before full migration:

${numberedTable(
  ["Mongo collection", "Feature area"],
  [
    ["`ws_live_courses`, `ws_live_sessions`, `ws_live_chat_*`", "Live classes"],
    ["`ws_test_series*`", "Test series product"],
    ["`ws_lecture_*`, `ws_folders`, `ws_folder_items`", "Student library / notes"],
    ["`ws_faq_types`", "FAQ categories (MySQL uses `type` enum instead)"],
    ["`ws_social_link*`", "Social links CMS"],
    ["`ws_notifications` (image/popup differ)", "Push / in-app notifications"],
    ["`ws_ebook_downloads`, `ws_wishlists`", "Client features"],
    ["`ws_exam_countdown*`", "Exam countdown widgets"],
    ["`ws_book_settings`, `ws_counters`", "Book commerce helpers"],
  ]
)}

---

## Appendix A — Customer (\`ws_customer\` / \`ws_customers\`) ⏳ planned

${numberedTable(
  [
    "Legacy MySQL (`ws_customer`)",
    "Type / constraints",
    "MongoDB (`ws_customers`)",
    "Post-migration (`ws_customer` via Prisma)",
  ],
  [
    ["`id`", "INT PK AI", "`_id` ObjectId", "`id` Int PK"],
    [
      "`full_name`",
      "varchar(255) NULL",
      "`firstName`, `middleName`, `lastName`",
      "`full_name` ← API may split/join names",
    ],
    ["`phone`", "varchar(100) NOT NULL", "`phoneNumber` unique", "`phone` @map"],
    ["`email_address`", "varchar(255)", "`emailAddress`", "`email_address`"],
    ["`referral_code`", "varchar(15)", "`referralCode`", "`referral_code`"],
    ["`reward_points`", "int default 0", "`rewardPoints`", "`reward_points`"],
    ["`password`", "varchar(255)", "`password`", "`password`"],
    ["`is_phone_verified`", "tinyint", "`isPhoneVerified`", "`is_phone_verified`"],
    [
      "`otp`, `otp_expires_at`, `tried_otp`, `otp_blocked_at`",
      "OTP fields",
      "same camelCase",
      "same @map",
    ],
    ["`profile_picture`", "varchar(255)", "`profilePicture`", "`profile_picture`"],
    ["`phone_2`", "varchar(15)", "`phone2`", "`phone_2`"],
    ["`dob`", "date", "`dob`", "`dob`"],
    ["`education_id`", "int FK-ish", "`educationId` ObjectId", "`education_id` Int"],
    ["`state`, `district`", "int", "`stateId`, `districtId` ObjectId", "`state`, `district` Int FK"],
    ["`city`, `gender`, `language`", "varchar", "same", "same"],
    ["`goal`", "**JSON** array of goal ids", "`goals` ObjectId[]", "`goal` Json"],
    ["`facebook_id`", "varchar (legacy)", "—", "— (drop or nullable migration)"],
    ["`verified`", "tinyint", "`verified`", "`verified`"],
    ["`device`", "text (FCM)", "`firebaseTokens[]` embedded", "`device` text (single token legacy)"],
    ["`os_type`", "enum android/ios", "`osType`", "`os_type`"],
    ["`last_login_*`, `login_count`, `is_login`", "login meta", "same", "same @map"],
    ["`is_account_deleted`, `status`", "flags", "same", "same"],
    ["`created_at`, `updated_at`", "timestamps", "camelCase", "snake_case @map"],
    ["—", "—", "`isProfileCompleted`", "— (Mongo-only flag; derive on migrate)"],
  ]
)}

**Migration risk:** High — auth, tokens, and profile APIs depend on this. Transformer must preserve mobile/admin JSON contracts.

---

## Appendix B — Book (\`ws_book\` / \`ws_books\`) ⏳ planned

${numberedTable(
  ["Legacy MySQL (`ws_book`)", "MongoDB (`ws_books`)", "Post-migration Prisma", "Notes"],
  [
    ["`id` int PK", "`_id` ObjectId", "`id` Int", ""],
    ["`name`", "`name`", "`name`", ""],
    ["`thumbnail`, `author`, `image`, `description`", "same", "same", ""],
    ["`demo_url`", "`demoUrl`", "`demo_url`", ""],
    ["—", "`bookUrl`", "—", "Mongo-only field"],
    ["—", "`examCountdownCategoryId`", "—", "Mongo-only ObjectId"],
    ["`weight`, `pages`, `dynamic_link`", "same", "same", ""],
    ["`list_price`, `discounted_price`, `shipping_price`", "camelCase", "snake_case", ""],
    ["`order_by`", "`orderBy`", "`order_by`", ""],
    ["`language`", "`language`", "`language`", ""],
    ["`is_magazine`, `is_combo`", "same", "`is_magazine`, `is_combo`", ""],
    ["`status`", "`status`", "`active` @map `status`", "Prisma field rename"],
    ["—", "`publication`, `deliveryEta`, `isTrending`", "—", "Mongo commerce extras"],
    ["`created_at`, `updated_at`", "timestamps", "same", ""],
  ]
)}

**Related legacy tables (Prisma, no Mongoose model):** \`ws_book_cart\`, \`ws_book_cart_item\`, \`ws_book_order\`, \`ws_book_order_item\`, \`ws_book_tracking\`.  
**Mongo extras:** \`ws_book_orders\`, \`ws_book_carts\`, \`ws_book_settings\`, \`ws_counters\`.

---

## Maintenance

1. After adding a Prisma module migration, update \`MIGRATION_MYSQL_MODULES\` and re-run \`yarn docs:schema-comparison\` and \`yarn docs:field-comparison\`.
2. Edit **Appendix A/B** in \`scripts/generate-schema-comparison.ts\` if column mappings change; re-run \`yarn docs:schema-comparison\`.
3. Add a manual subsection under **Column-level detail** if the generator’s auto-mapping is insufficient (complex renames).
4. Link from [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md), [MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md), and [testing-guide.md](./testing-guide.md).

`;

  const outPath = path.join(ROOT, "docs/migration/SCHEMA_COMPARISON.md");
  fs.writeFileSync(outPath, md);
  console.log(`Wrote ${outPath} (${rows.length} inventory rows)`);
}

main();
