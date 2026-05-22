# Data Retention & Archival Policy

Long-running collections that lack a retention plan are a tax that compounds: index size grows linearly with row count, range scans get slower, backups get larger and slower, and a single Atlas tier upgrade can be 2x your monthly bill.

This doc is the **spec** for the retention work — it identifies every high-volume collection in the system, classifies it by how much history is actually useful, and recommends a cleanup approach. The actual implementation (TTL indexes, archival workers, S3 dumps) lives in follow-up tickets.

---

## Status snapshot

| Collection | Approx growth rate | Current retention | Recommended | Status |
|---|---|---|---|---|
| ws_customer_otps | ~3k/day | **10 min TTL ✅** | 10 min | **Done** (Batch 5) |
| ws_customer_access_tokens | ~500/day net (login churn) | **TTL on expiresAt ✅** | unchanged | Done (pre-existing) |
| ws_admin_access_tokens | ~10/day | **TTL on expiresAt ✅** | unchanged | Done (pre-existing) |
| ws_referral_transactions | ~200/day | none | Hot: 12 months. Archive to S3 quarterly. | Open |
| ws_live_chat_messages | ~50k/day during live | none | Hot: 90 days. Archive per-session to S3 after class ends. | Open |
| ws_live_session_attendances | ~5k/day | none | Hot: 12 months. Aggregate before archive. | Open |
| ws_live_poll_votes | ~10k/day during live | none | Hot: 90 days. Aggregate per-poll first. | Open |
| ws_notifications | ~100/day | none | Hot: 6 months. | Open |
| ws_signed_urls (if used) | per request | none | 5 min TTL | Open |
| ws_video_watch_events (if used) | per second/viewer | none | Hot: 30 days; aggregate first. | Open |

---

## Classification

Three categories of high-volume rows:

### 1. Ephemeral (≤1 hour useful)
OTPs, signed-URL grants, captcha challenges, password reset tokens, idempotency keys.

**Retention:** Mongoose TTL index on `createdAt` or `expiresAt`.
**Reason:** Past the grant window the row has zero business value. Anything that wants longer-lived audit moves to a separate audit log.

### 2. Hot operational (≤90 days useful for product features)
Live chat messages, poll votes, attendance rows during ongoing terms.

**Retention:** TTL on `createdAt` set to the operational window (e.g. 90 days), OR a periodic archival worker that moves rows older than N days to S3 cold storage before deletion.
**Reason:** Live chat from 6 months ago is never queried by the live-class UI. Aggregating (count of votes per option, total attendance per session) preserves the analytical signal without keeping every row.

### 3. Audit / financial (≥1 year required)
Referral transactions, subscription rows, order rows, payment webhooks.

**Retention:** No TTL. Periodic archival to S3 (parquet or JSON), with the row count in primary kept bounded by archiving everything older than 12-24 months.
**Reason:** Tax and dispute requirements (typically 7 years in IN for financial records). But primary doesn't need to be the storage location — Mongo is the wrong tool for cold queries that happen quarterly.

---

## Implementation notes

### TTL approach (categories 1 + 2)

Mongoose TTL index, declared on the schema:

```ts
SomeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86_400 });
```

Mongo's TTL monitor wakes once per minute; deletions lag the timestamp by up to 60 seconds. That's fine for everything in scope.

**Pitfall:** TTL only fires on documents that HAVE the indexed field. Schemas where the field can be `null` need a sparse TTL or a partial filter. Verify when adding.

### Archival approach (categories 2 + 3)

A scheduled worker (BullMQ delayed-cron, or a separate process) that:

1. Queries rows older than `cutoff` with a stable batch size (e.g. 10k).
2. Streams them to an S3 object (`s3://archive/{collection}/{yyyy}/{mm}.jsonl.gz`).
3. After the S3 upload reports success, deletes the batch from Mongo.
4. Continues until no more rows.

**Don't:**
- Delete first, then upload. If S3 fails you've lost the rows.
- Run during peak hours. Schedule for low-traffic windows.
- Run without a `delete_after` flag in code so you can dry-run for a week and check the S3 output before turning on deletion.

**Verification:** monthly query `db.{coll}.estimatedDocumentCount()` and confirm growth stayed below archival rate.

### Aggregation-before-archive

For live poll votes and attendance rows: instead of archiving raw rows, compute the aggregates the dashboard needs (totals per option, distinct customer count per session) and store those in a small `*_summary` collection. Then delete the raw rows entirely after 90 days.

Reduces archival storage by ~99% on these high-cardinality collections.

---

## Sign-off matrix

For each collection in the "Open" rows above, the next steps are:

| Collection | Owner | Step 1 — measure | Step 2 — design | Step 3 — implement |
|---|---|---|---|---|
| ws_referral_transactions | Finance/Compliance | Confirm IN regulatory retention period | Choose archival format + S3 bucket | Worker + admin override path for disputes |
| ws_live_chat_messages | Product/Live | Confirm 90 days is enough for "show recent" UI | Per-session JSONL upload pattern | BullMQ archive job triggered by live-session end |
| ws_live_session_attendances | Analytics | Define which aggregates the dashboards need | Add `*_summary` schema | Backfill + cutover |
| ws_live_poll_votes | Same as attendances | Same | Same | Same |
| ws_notifications | Product | Confirm 6 months is enough for "delivery history" | Decide if archive needed at all | TTL index OR manual purge |
| ws_video_watch_events | Analytics | Confirm 30-day window | Define daily-rollup schema | Replace raw inserts with rollup |

Each step is a separate ticket; this batch only documents the policy.

---

## What this doc is NOT

- A migration plan for existing data. Anything currently in primary stays there until the archival worker is built; no code in this batch deletes existing rows.
- A schema-strict-throw audit. That's a separate concern (see Batch 5 for the financial-ledger schemas).
- An indexing audit. Index hit list lives in `batch-1a-foundation.md`.
