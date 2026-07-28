// src/utils/prismaSchemaDrift.ts
//
// Turns "schema drift" Prisma failures into an actionable log line instead of a
// generic 500.
//
// WHY THIS EXISTS: on 2026-07-28 `GET /client/downloads/encryption-key` returned
// 500 for every caller. The database was fine and the column existed — the
// running process was holding a Prisma client generated BEFORE the schema gained
// `Customer.downloadKeyHex`. `prisma generate` writes into node_modules, which
// does not trip `tsx watch`, so the server never picked it up. The only clue was
// a PrismaClientValidationError buried in a stack trace, and the frontend team
// spent a bug report guessing at a missing table.
//
// Two distinct faults produce that same opaque 500, and they have DIFFERENT
// fixes — naming which one it is, is the whole point of this module:
//
//   CLIENT_STALE  — generated client is behind prisma/schema.prisma.
//                   Fix: `yarn prisma:generate` + RESTART the process.
//   DDL_MISSING   — schema.prisma/client know a table/column the DATABASE lacks.
//                   Fix: apply the pending DDL in docs/migration/schema-changes/.
//
// This module NEVER changes control flow: detection only. The caller rethrows,
// the request still 500s. That matters — an endpoint like the download-key one
// documents "404 means no key, mint one", so quietly converting a drift failure
// into any non-5xx would tell the app to mint a duplicate key and orphan a
// user's already-downloaded files.

import logger from "./logger";

export type SchemaDriftKind = "CLIENT_STALE" | "DDL_MISSING";

export interface SchemaDrift {
  kind: SchemaDriftKind;
  /** What is out of sync, e.g. "Customer.downloadKeyHex" or "ws_customer.download_key_hex". */
  subject: string;
  /** One-line statement of the mismatch. */
  reason: string;
  /** The command/step that actually fixes it. */
  action: string;
}

const CLIENT_STALE_ACTION =
  "Run `yarn prisma:generate` and RESTART the process. `prisma generate` writes into node_modules, which does NOT trigger tsx watch — a running dev server keeps the old client until it is restarted.";

const DDL_MISSING_ACTION =
  "Apply the pending DDL from docs/migration/schema-changes/ (e.g. `npx prisma db execute --file <file> --schema prisma/schema.prisma`), then `yarn prisma:generate` and restart.";

const errName = (err: unknown): string =>
  (err as { name?: unknown } | null)?.name === undefined
    ? ""
    : String((err as { name?: unknown }).name);

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === "string" ? err : "";

const errCode = (err: unknown): string =>
  (err as { code?: unknown } | null)?.code === undefined
    ? ""
    : String((err as { code?: unknown }).code);

/**
 * Classify a Prisma error as schema drift, or return `null` if it is an ordinary
 * failure (constraint violation, timeout, not-found, …).
 *
 * Deliberately matches on message text as well as error codes: the
 * client-is-stale case surfaces as `PrismaClientValidationError`, which carries
 * no machine-readable code at all — the field name only exists in the message.
 */
export const detectPrismaSchemaDrift = (err: unknown): SchemaDrift | null => {
  const name = errName(err);
  const message = errMessage(err);
  const code = errCode(err);

  // ── CLIENT_STALE ──────────────────────────────────────────────────────────
  // PrismaClientValidationError: the query referenced something the GENERATED
  // client has never heard of. Nothing reached MySQL. Typical text:
  //   "Unknown field `downloadKeyHex` for select statement on model `Customer`."
  //   "Unknown arg `downloadKeyHex` in data.downloadKeyHex for type CustomerUpdateInput."
  if (name === "PrismaClientValidationError") {
    const unknownField = /Unknown (?:field|arg(?:ument)?) `([^`]+)`/.exec(message);
    const onModel = /on model `([^`]+)`|for type (\w+)/.exec(message);
    if (unknownField) {
      const model = onModel?.[1] ?? onModel?.[2] ?? "unknown model";
      return {
        kind: "CLIENT_STALE",
        subject: `${model}.${unknownField[1]}`,
        reason: `The generated Prisma client has no field \`${unknownField[1]}\` on \`${model}\`, but the code queries it — the client is older than prisma/schema.prisma.`,
        action: CLIENT_STALE_ACTION,
      };
    }
    // Unknown *model* (accessor undefined) shows up earlier as a TypeError on
    // `prisma.<model>` being undefined; caught by the wrapper below instead.
  }

  // A dropped/renamed model accessor: `prisma.customerDownloadKey.findUnique(...)`
  // where the client has no such model → "Cannot read properties of undefined".
  if (
    err instanceof TypeError &&
    /Cannot read properties of undefined \(reading '(\w+)'\)/.test(message)
  ) {
    const op = /reading '(\w+)'/.exec(message)?.[1] ?? "operation";
    return {
      kind: "CLIENT_STALE",
      subject: `prisma.<model>.${op}`,
      reason: `A Prisma model accessor is undefined — the generated client does not contain the model this code calls \`${op}\` on.`,
      action: CLIENT_STALE_ACTION,
    };
  }

  // ── DDL_MISSING ───────────────────────────────────────────────────────────
  // The client knows the shape; MySQL does not. P2021 = table, P2022 = column.
  if (code === "P2021" || code === "P2022") {
    const meta = (err as { meta?: Record<string, unknown> }).meta ?? {};
    const subject = String(meta.table ?? meta.column ?? "unknown");
    return {
      kind: "DDL_MISSING",
      subject,
      reason:
        code === "P2021"
          ? `Table \`${subject}\` does not exist in the database, but the Prisma schema declares it.`
          : `Column \`${subject}\` does not exist in the database, but the Prisma schema declares it.`,
      action: DDL_MISSING_ACTION,
    };
  }

  // Raw `$queryRaw` / `$executeRaw` bypass Prisma's typed layer, so the same
  // fault arrives as a bare MySQL error code instead: 1054 unknown column,
  // 1146 no such table.
  const rawUnknownColumn = /Unknown column '([^']+)'/.exec(message);
  const rawUnknownTable = /Table '[^']*?\.?([^'.]+)' doesn't exist/i.exec(message);
  if (rawUnknownColumn || rawUnknownTable) {
    const subject = rawUnknownColumn?.[1] ?? rawUnknownTable?.[1] ?? "unknown";
    return {
      kind: "DDL_MISSING",
      subject,
      reason: `A raw SQL query referenced \`${subject}\`, which does not exist in the database.`,
      action: DDL_MISSING_ACTION,
    };
  }

  return null;
};

// Drift is a deploy-state bug, not a per-request one: a hot endpoint would emit
// the identical line thousands of times and bury everything else. One log per
// distinct subject per window is enough to notice and act.
const LOG_COOLDOWN_MS = 5 * 60 * 1000;
const lastLoggedAt = new Map<string, number>();

const shouldLog = (key: string, now: number): boolean => {
  const previous = lastLoggedAt.get(key);
  if (previous !== undefined && now - previous < LOG_COOLDOWN_MS) return false;
  lastLoggedAt.set(key, now);
  // Bounded: the key space is (kind × subject), but clear defensively so a
  // pathological caller can't grow this unbounded over a long uptime.
  if (lastLoggedAt.size > 200) lastLoggedAt.clear();
  return true;
};

/**
 * Log a drift diagnosis if `err` is one. Returns the drift (or `null`) so the
 * caller can decide what else to do — but callers should ALWAYS rethrow: this
 * function deliberately has no effect on control flow.
 */
export const logPrismaSchemaDrift = (
  err: unknown,
  context: Record<string, unknown> = {}
): SchemaDrift | null => {
  const drift = detectPrismaSchemaDrift(err);
  if (!drift) return null;

  if (shouldLog(`${drift.kind}:${drift.subject}`, Date.now())) {
    logger.error(
      `PRISMA SCHEMA DRIFT [${drift.kind}] ${drift.subject} — ${drift.reason} FIX: ${drift.action}`,
      {
        ...context,
        schemaDrift: true, // greppable / alertable flag
        driftKind: drift.kind,
        driftSubject: drift.subject,
        driftAction: drift.action,
        error: errMessage(err),
      }
    );
  }
  return drift;
};
