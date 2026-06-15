# Migration API tests (local HTTP)

Automated checks against **`yarn dev`** on your machine. Use these instead of hand-running PowerShell `Invoke-RestMethod` for migrated modules.

> **Prerequisites:** Server running, MySQL + Mongo + Redis up, dump imported, `MIGRATION_MYSQL_MODULES` includes the module under test.

---

## Migrated modules (current)

| Module | Test files | Yarn |
|--------|------------|------|
| `app-update` | admin + client (`/upgrade`) | `yarn migration:api:app-update` |
| `version` | admin + client | `yarn migration:api:version` |
| `faq` | admin + client | `yarn migration:api:faq` |

List source: `modules.manifest.ts` (keep in sync when you add a module).

---

## Setup (once per developer)

**Server must be running** (`yarn dev`). MongoDB must be reachable (local Docker e.g. port **27018**, or Atlas). MySQL + Redis per Phase 1/2 setup.

Add to **`new-web-sankul/.env`**:

```env
# Local API base (default: http://localhost:PORT)
MIGRATION_API_BASE_URL=http://localhost:4001

# Admin JWT — optional if login fails (uses minted test JWT + Redis)
MIGRATION_TEST_ADMIN_EMAIL=your-admin@example.com
MIGRATION_TEST_ADMIN_PASSWORD=your-password

# Client — defaults to first TESTING_PHONE_NUMBERS; OTP or minted JWT
MIGRATION_TEST_CUSTOMER_PHONE=9999999999
MIGRATION_TEST_CUSTOMER_OTP=5786

# Skip PUT/POST/DELETE tests (default: write tests RUN and revert data)
# MIGRATION_API_SKIP_WRITE=true
```

Ensure pilot modules are enabled:

```env
MIGRATION_MYSQL_MODULES=app-update,version,faq
```

---

## Commands

```powershell
cd D:\Projects\web-sankul\new-web-sankul

# Terminal 1
yarn dev

# Terminal 2 — all migrated modules
yarn migration:api

# One module
yarn migration:api:app-update
yarn migration:api:version
yarn migration:api:faq

# Skip write tests (read-only)
$env:MIGRATION_API_SKIP_WRITE="true"; yarn migration:api
```

Full endpoint list: [API_COVERAGE.md](./API_COVERAGE.md)
```

---

## Mock JWT (authentication)

Every authenticated API (admin + client) needs a Bearer token. The runner mints
a **mock admin JWT + mock customer JWT once, before any API runs**, and stores
them in `api-tests/.auth.json`. Every authenticated test then reuses that stored
token — no per-suite re-minting, no live login required.

- **Automatic:** `yarn migration:api` and `yarn migration:api:<module>` both call
  `ensureAuthStore()` first — it (re)generates `.auth.json` if missing or older
  than 50 min (minted JWTs last 1h).
- **Manual (re)generate:** `yarn migration:api:auth`
- **Store file:** `docs/migration/api-tests/.auth.json` — `{ admin, customer, mintedAt }`.
  Git-ignored; test-only short-lived tokens, never commit it.
- **Requires** `JWT_ACCESS_SECRET` in `.env` and Redis up (the mock token is also
  written to a Redis session key, matching production auth middleware).
- **Use real login instead of the mock JWT:** set `MIGRATION_TEST_REAL_LOGIN=true`
  (then admin email/password or customer OTP env vars apply as before).

---

## Folder layout

```txt
docs/migration/api-tests/
  README.md                 ← this file
  _lib/                     ← shared HTTP + auth (do not duplicate per module)
  app-update/
    admin.api.test.ts       ← add files when module is migrated
  version/
    admin.api.test.ts
    client.api.test.ts
  faq/
    admin.api.test.ts
    client.api.test.ts
  _template/
    MODULE.api.test.template.ts
  run-all.ts
  run-module.ts
```

**Rule:** When you finish migrating a module, create a folder named like the **module key** (`banner-slider`, `testimonial`, `customer`, …) and add `admin.api.test.ts` / `client.api.test.ts` as needed. Register the runner in `run-module.ts` and `run-all.ts`.

---

## After a test run

1. Log results in [MIGRATION_TEST_LOG.md](../MIGRATION_TEST_LOG.md) (reference `yarn migration:api:*`).
2. Follow [MIGRATION_DOC_UPDATES.md](../MIGRATION_DOC_UPDATES.md) for other docs.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Server not reachable` | Start `yarn dev`; check `PORT` / `MIGRATION_API_BASE_URL` |
| Admin login fails | Set `MIGRATION_TEST_ADMIN_*`; user must exist in Mongo `ws_users` |
| Client tests skipped | Set `MIGRATION_TEST_CUSTOMER_PHONE` |
| OTP validate fails | Add phone to `TESTING_PHONE_NUMBERS` in `.env` or use real OTP |
| Data mismatch | `MIGRATION_MYSQL_MODULES` + restart server; re-import dump |
| Session / 401 on client | Redis running; single-device rule — logout other sessions |

---

## Related

- [testing-guide.md](../testing-guide.md) — manual steps & DBeaver
- [MIGRATED_MODULES.md](../MIGRATED_MODULES.md) — which modules are on MySQL
