# WebSankul Postman Collection

`WebSankul-Complete-2026.postman_collection.json` — **878 requests**, every route the
server actually serves, grouped module-wise across the 4 API surfaces.

Import it together with `WebSankul.postman_environment.json`.

> Supersedes the split `WebSankul-Admin` / `WebSankul-Client` collections this file used to
> describe. Those were deleted; the single complete collection replaces both.

| Folder | Requests |
| --- | ---: |
| `CLIENT — /api/v1/client` | 256 |
| `ADMIN — /api/v1/admin` | 570 |
| `EDUCATOR — /api/v1/educator` | 16 |
| `PROMOTER — /api/v1/promoter` | 15 |
| `🪝 Webhooks` | 1 |
| `🌐 PUBLIC & INFRA` | 20 |
| **Total** | **878** |

## Setup

1. **Import** the collection + the environment file, then select the environment.
2. Set `base_url` (the `/api/v1` root, e.g. `http://localhost:3000/api/v1`) and `host`
   (same server **without** that prefix).
3. Run a **login** request — the token is captured automatically and every other request
   in that surface is then authenticated.

### `base_url` vs `host`

Health probes, `/metrics`, `/share/*`, `/demo/*` and the deep-link association files
(`/.well-known/*`) are mounted at the **root**, outside `/api/v1`. Those requests use
`{{host}}`; everything else uses `{{base_url}}`.

### Auth

Collection default is Bearer `{{client_token}}`; the admin / educator / promoter folders
override with their own token variable. Public routes (login, OTP, token refresh, health,
share, deep-link files) are explicitly **No Auth**.

`POST /webhooks/razorpay-payout` is **HMAC-signed**, not Bearer — it sends
`x-razorpay-signature` (HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`).

## Keeping it honest

The collection is reconciled against the **live Express router tree**, not a grep of
`*.routes.ts`. Static parsing both misses dynamically-mounted routers and retains deleted
routes — which is exactly how this collection had drifted to 926 entries against 878 real
ones: **46 endpoints missing, 17 pointing at routes that no longer existed, 77 duplicates.**

```bash
yarn postman:sync      # dump real routes, then add / drop / dedupe the collection
yarn postman:routes    # just regenerate docs/postman/routes.generated.json
```

`yarn postman:sync` is **idempotent** — a clean run reports `0 / 0 / 0`. Run it after adding
or removing any route; a non-zero report means the collection has drifted.

### Why it patches Express instead of walking the stack

Express 5 keeps a Layer's mount path inside a closure (`matchers`) rather than a readable
`regexp`, so walking `app._router.stack` after boot cannot recover prefixes — it produces
paths like `///:id`. `scripts/dump-routes.ts` therefore patches `express.Router()`
**before** `src/app.ts` loads and records each `.use(path, router)` / `.METHOD(path)` as it
registers, reconstructing full paths from that tree.

### What the reconciler will and won't touch

`scripts/reconcile-postman.py` only adds, drops, or de-duplicates whole requests.
Hand-written bodies, `pm.test` scripts, descriptions and query-param docs on surviving
requests are **left untouched**. De-duplication keeps the **richest** copy (most body /
tests / description), not blindly the first.

Auto-added requests are marked as such in their description and carry a `{}` placeholder
body — bodies are **not** derived from the Zod validators, so fill them in from
`src/**/*.validation.ts` as you use them.

## Notes

- Path params appear as `:id`, `:planId`, … — Postman exposes these in the request's
  **Path Variables** tab.
- `multipart/form-data` upload requests have file fields preset as **File** type; pick a
  file in the form-data editor before sending.
- `routes.generated.json` is a build artifact (the raw method+path dump). It is the input
  to the reconciler, not something to edit by hand.
