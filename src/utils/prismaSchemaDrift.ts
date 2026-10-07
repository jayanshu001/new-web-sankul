// Prisma schema drift: names the fault behind a drift failure in the logs. Two faults
// produce the same opaque 500 with different fixes:
//   CLIENT_STALE - generated client is behind prisma/schema.prisma
//                  (`prisma generate` does not trip `tsx watch`; regenerate + restart).
//   DDL_MISSING  - schema/client know a table/column the database lacks
//                  (apply the pending DDL in docs/migration/schema-changes/).
// Detection only: callers rethrow and the request still 500s. Softening it to a
// non-5xx would be harmful, e.g. the download-key endpoint treats 404 as "mint a
// new key" and would orphan a user's downloaded files.

import logger from "./logger";

export type SchemaDriftKind = "CLIENT_STALE" | "DDL_MISSING";

export interface SchemaDrift {
  kind: SchemaDriftKind;
  /** e.g. "Customer.downloadKeyHex" or "ws_customer.download_key_hex". */
  subject: string;
  reason: string;
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
 * Classify a Prisma error as schema drift, or `null` for an ordinary failure.
 * Matches message text as well as codes because PrismaClientValidationError (the
 * stale-client case) carries no code; the field name exists only in the message.
 */
export const detectPrismaSchemaDrift = (err: unknown): SchemaDrift | null => {
  const name = errName(err);
  const message = errMessage(err);
  const code = errCode(err);

  // Query referenced something the generated client lacks; nothing reached MySQL.
  // e.g. "Unknown field `x` for select statement on model `Customer`."
  //      "Unknown arg `x` in data.x for type CustomerUpdateInput."
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
  }

  // Unknown model: the `prisma.<model>` accessor is undefined, so it surfaces as a TypeError.
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

  // P2021 = table, P2022 = column missing in MySQL.
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

  // Raw queries surface the same fault as MySQL 1054 (column) / 1146 (table).
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

// Drift is a deploy-state bug; log once per subject per window so a hot endpoint
// doesn't bury everything else.
const LOG_COOLDOWN_MS = 5 * 60 * 1000;
const lastLoggedAt = new Map<string, number>();

const shouldLog = (key: string, now: number): boolean => {
  const previous = lastLoggedAt.get(key);
  if (previous !== undefined && now - previous < LOG_COOLDOWN_MS) return false;
  lastLoggedAt.set(key, now);
  // Defensive bound over a long uptime.
  if (lastLoggedAt.size > 200) lastLoggedAt.clear();
  return true;
};

/** Log a drift diagnosis if `err` is one and return it. Callers must still rethrow. */
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
        schemaDrift: true, // alertable flag
        driftKind: drift.kind,
        driftSubject: drift.subject,
        driftAction: drift.action,
        error: errMessage(err),
      }
    );
  }
  return drift;
};
