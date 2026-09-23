# CLAUDE.md

Backend API for the **WebSankul** ed-tech platform. Verified against source; documents
only what exists. The Mongo→MySQL migration is **COMPLETE**: the app is MySQL-only
(Prisma). Mongoose is uninstalled, `src/models/**` is deleted, and the per-module
`isMysqlModule()` flag layer has been removed. Anything describing a dual-DB
switch is history — do not reintroduce it.

## Stack

Node + TypeScript (**CommonJS** — `tsconfig` `"module":"commonjs"`, and package.json
has NO `"type":"module"`; do not write ESM-only syntax or `.js` import suffixes),
Express 5. MySQL via Prisma 5 (sole datastore). Redis (`ioredis`) + BullMQ jobs.
Socket.io + `ws`. JWT + bcryptjs auth. Zod validation. DigitalOcean Spaces (S3)
storage. Razorpay payments. `firebase-admin` FCM + nodemailer SMTP.
VideoCrypt/StreamOS video. ejs + puppeteer (receipt/solution PDFs). PM2 process
mgmt. Winston logging. Helmet/CORS/rate-limit security.

## Commands

```bash
yarn dev               # tsx watch src/index.ts (hot reload)
yarn build             # tsc -> ./dist
yarn typecheck         # tsc --noEmit  ← the only verification gate; run before "done"
yarn start             # pm2 start ecosystem.config.cjs (prod)
yarn db:up / db:down   # docker compose ws-mysql (host port 3307)
yarn db:pull           # prisma db pull (schema is introspected, not hand-authored)
yarn prisma:generate   # regenerate Prisma client
yarn db:verify         # tsx scripts/verify-mysql.ts
yarn migration:api[:<module>]   # per-module integration smoke tests vs real MySQL
```
No unit-test runner or linter — `yarn typecheck` is the gate.

## Boot Flow

`src/index.ts`: dotenv → `validateEnvOrExit()` (fail-fast) → `connectPrisma()`
→ seed permission catalog → start
notification + PDF-upload schedulers → HTTP server (keep-alive 65s > LB timeout) →
attach Socket.io (livechat, camera-ingest, pdf-progress) → graceful shutdown (drains
via `/readyz`=503). `src/app.ts` assembles middleware in a **deliberately ordered,
heavily-commented chain** — read the comments before reordering. Notable: JSON body
parser only fires when Content-Type explicitly says JSON (else multipart upload
streams get drained); `req.rawBody` is stashed for webhook HMAC; health/`/metrics`
mounted before the rate limiter.

## Layout

```
src/
  index.ts app.ts          # bootstrap; Express assembly + route mounting
  config/                  # env, prisma, redis, rateLimiter, jwtKeys, corsOrigins, streamos, courier
  middlewares/             # authenticate(+requireRole), validate, errorHandler, health, upload, idempotency, requestContext...
  client/ admin/ educator/ promoter/   # the 4 API surfaces: *.routes.ts + *.controller.ts + *.validation.ts per domain
  modules/                 # MySQL/Prisma business logic, ~100 modules (see split below)
  socket/ webhooks/ deeplinking/ libs/ utils/ migrations/
prisma/schema.prisma       # MySQL: ~121 models, introspected from legacy ws_* DB
scripts/                   # tsx one-off / backfill / verify scripts
docs/migration/            # migration plans + status (authoritative)
```

### Two layers — internalize before editing
1. **Route/controller** in `src/{admin,client,educator,promoter}/<domain>/`. Aggregated
   in `<surface>.routes.ts`.
2. **MySQL logic** in `src/modules/<module>/`, fixed file split:
   - `*.repository.ts` — Prisma calls ONLY
   - `*.service.ts` — business logic
   - `*.transformer.ts` — Prisma row → stable DTO (still Mongo-*shaped*: `_id` as a
     string, populated sub-objects, camelCase out — the clients depend on it)
   - `*.types.ts` / `*.validation.ts` — DTO/input types; Zod schemas

   Controllers call services; services call repositories; the transformer keeps the
   JSON shape frozen.

## Database (core concern)

- **MySQL/Prisma:** `prisma/schema.prisma`, ~121 models, `ws_*` tables via `@@map`,
  snake_case columns, integer PKs. Client accessors are generated names — check schema
  (e.g. model `FAQ` → `prisma.fAQ` → table `ws_faq`).
- **There is no second datastore.** No Mongo, no Mongoose, no `isMysqlModule()`, no
  `MIGRATION_MYSQL_MODULES`. `src/config/migration.ts` and `src/models/**` no longer
  exist. Do not add a backend-selection branch.
- **Contract rule:** the API response shape MUST stay frozen — that is what transformers
  are for (`_id` as string, populated sub-objects, camelCase out). The shape is
  Mongo-legacy because live clients parse it, not because Mongo is still there.
- **Always log** every query/schema/index/migration change in
  `docs/MIGRATION_QUERY_CHANGES.md` (newest first), and keep `docs/migration/*` plan
  docs current. DDL lives in `docs/migration/schema-changes/*.sql`.

## Canonical Module Pattern

Every module follows the same shape (reference: `src/modules/faq/`):

```ts
const row = await faqRepository.findById(id);

if (!row) {
  throw new Error("FAQ not found");
}

return faqTransformer.toDto(row);
```

Responsibilities:
- **Controllers** call services — never a repository or Prisma directly.
- **Services** hold the business logic; no backend branching (there is one backend).
- **Repositories** contain Prisma queries only — no business logic.
- **Transformers** normalize Prisma rows into the stable DTO.
- **The response shape must never change** — clients in the wild parse it as-is.

## API & Auth

- Routes: `/api/v1/{client|admin|educator|promoter}/<domain>/...`. Each surface has a
  master router mounting per-domain routers.
- **Auth contract:** `/auth/login` + `/auth/refresh` mounted BEFORE the master
  `authenticate`; everything after `router.use(authenticate, <limiter>)` requires a
  Bearer token. `requireRole(...)` (exported from `middlewares/authenticate.ts`) adds
  finer authz; RBAC permission catalog is seeded at boot. Webhooks
  (`/api/v1/webhooks/razorpay-payout`) use HMAC, not Bearer.
- `req.user = { id, role, ... }`, role ∈ customer|admin|super_admin|editor|educator|promoter.
  JWT verified via a rotating key ring (`utils/jwtSigner.ts`, `kid` header); revocation
  via `libs/tokenRevocation.ts` (logout-all / forced re-auth).
- **Responses:** always use `utils/httpResponse.ts` → `success()` / `failure()`. Envelope:
  `{ success, code, data, message, messages }`. Zod `validate({body?,query?,params?})`
  returns **422** with a flat `field→message` map under `messages`, and replaces the
  request slice with parsed/coerced values.

## Project-specific business rules

- **Every route (admin + client) requires a Bearer token.** Never default a new route to
  public; only auth/refresh/webhook/health/share are exceptions.
- **Video URL responses have a fixed contract** — match `/v1/lecture`'s encryption +
  shape (`utils/videoEncryption.ts`, `utils/videoResolver.ts`).
- **`duration` on course/package/ebook/live price rows is in DAYS** — compute `endAt`
  via `utils/planDuration.ts` (`setDate`), never `setMonth`.
- Profile dashboard **`downloads` = savedMaterials + savedVideos + activeEbookDownloads**.
- **Saved Materials** lists grouped by lecture (Video / LiveSession, title = lecture
  title), not by parent course.
- **LectureProgress is per-container:** one row per `(customer, lecture, container)`;
  heartbeat `scope` is required + authoritative. Same video in 2 products = 2 cards.
- **Ebook PDFs (≤500MB)** upload direct-to-Spaces via `/admin/uploads/presign` (not the
  multer proxy). Admin single-PDF→ebook runs a **BullMQ pipeline (concurrency 1)** with
  live Socket.io progress (`POST /admin/ebooks/:id/pdf`) — distinct from presign and bulk.
- Courier: **Tirupati** is the only live AWB API; **Mahavir** is a page link only. Orders
  ≥ `TIRUPATI_INITIAL_NUMBER` route to Tirupati.

## Rules when modifying code

1. Run `yarn typecheck` before declaring done.
2. Keep API response shapes identical when migrating/editing — change DTOs only deliberately.
3. Respect middleware/route ordering in `app.ts` and route files (comments explain why).
4. New routes require auth unless documented otherwise; use `success()`/`failure()` + Zod `validate`.
5. In `src/modules/`, follow the repository/service/transformer/types/validation split; keep Prisma calls in the repository.
6. Do NOT add backend-selection branches or per-module flags — there is one datastore.
7. Log query/schema/migration changes in `docs/MIGRATION_QUERY_CHANGES.md` + update `docs/migration/*`.
8. Don't hand-edit `schema.prisma` carelessly — prefer `yarn db:pull` + `yarn prisma:generate`.
9. Secrets in `.env` (validated at boot); add new required vars to `config/env.ts` + `.env.example`.

## Implementation Strategy

Existing pattern first. Before creating new code:

1. Search for an existing implementation of the same pattern.
2. Follow the closest existing module.
3. Reuse existing utilities (`src/utils/`, `src/libs/`) before creating new helpers.
4. Reuse existing validators (Zod schemas in `*.validation.ts`) before writing new validation.
5. Reuse existing transformers when possible.
6. Keep naming consistent with neighboring modules.
7. Prefer consistency over cleverness.

## Common Mistakes

- Do not call Prisma directly from controllers.
- Do not place business logic inside repositories.
- Do not bypass transformers when returning MySQL data.
- Do not return raw Prisma rows in API responses.
- Do not reintroduce MongoDB, Mongoose, or `isMysqlModule()`-style backend flags.
- Do not change API response envelopes.
- Do not reorder middleware without understanding the documented reason.
- Do not create public routes unless explicitly documented.
- Do not hand-edit `schema.prisma` when introspection is the source of truth.
- Do not introduce a new architectural pattern when an existing one already exists.

## When Unsure

When uncertain, default to preservation:

- Preserve existing behavior.
- Preserve response contracts.
- Preserve authentication requirements.
- Preserve middleware ordering.
- Prefer extending an existing module over inventing a new pattern.
- **Ask for clarification before modifying** authentication, payment flows, video delivery, migration infrastructure, background jobs (BullMQ), or database schemas.

## Verification Checklist

Before declaring any task complete:

1. Run `yarn typecheck`.
2. Verify affected API response shapes remain unchanged.
3. Verify the affected module still compiles and behaves (`yarn typecheck` is the only gate).
4. Verify transformers continue to return the same DTO structure.
5. Verify authentication and middleware ordering have not been unintentionally changed.
6. Verify no dead backend-selection scaffolding was reintroduced.
7. Update migration documentation if queries, schema, indexes, repositories, or transformers were modified.
8. Update `docs/MIGRATION_QUERY_CHANGES.md` when database behavior changes.
9. Regenerate the Prisma client (`yarn prisma:generate`) if schema changes require it.

## Definition of Done

A task is not complete until:

- `yarn typecheck` passes.
- Response contracts remain unchanged unless explicitly requested.
- Migration documentation is updated when required.
- New code follows repository/service/transformer separation.
- Authentication rules remain intact.
- No Mongo/dual-backend scaffolding was reintroduced.
- Required environment variables are documented (`config/env.ts` + `.env.example`).
- The implementation matches existing project conventions.

## Env

`.env` (see `.env.example`), validated at boot by `config/env.ts`. Required always:
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`. Required in prod:
`ALLOWED_ORIGINS`, `RAZORPAY_WEBHOOK_SECRET`, `REDIS_HOST`, `REDIS_PORT`.
Warn-only in prod (`PROD_FEATURE_VARS` — the process still boots, the feature is
just off): `SMTP_HOST`, `FIREBASE_SERVICE_ACCOUNT`, `DO_ACCESS_KEY_ID`,
`DO_SECRET_ACCESS_KEY`, `METRICS_TOKEN`. Other groups: Spaces (DO_*),
Razorpay, 2Factor SMS OTP, Firebase, VideoCrypt/StreamOS, deep-linking, courier
(Tirupati/Mahavir), PM2 scaling. `docker-compose.yml` = ws-mysql (port 3307) + Redis.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
