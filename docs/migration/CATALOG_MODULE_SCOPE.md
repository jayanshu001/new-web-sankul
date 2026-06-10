# Catalog Module — Migration Scope

> **Created:** 2026-06-10
> **Tracker:** §15 step 5 — the read-heavy data backbone (courses, packages, videos). Required by commerce + dashboard.
> **Pattern:** `repository → service → transformer` + `isMysqlModule("<key>")` dual-path.
> **Standing rule (memory):** any endpoint returning video URLs MUST match `/v1/lecture`'s encryption + shape.

---

## 0. Scope boundary — catalog (read) vs commerce (later)

**IN scope (catalog read backbone):**
| Table | Prisma model | Rows | Notes |
|---|---|---|---|
| `ws_package` | `Package` | 4 | + `ws_package_type` (`PackageType`) |
| `ws_course` | `Course` | 1 | + `ws_course_subject_category` |
| `ws_video` | `Video` | 156 | + `ws_video_category` (157), relation tables |

**OUT of scope (commerce wave — orders/subscriptions/carts):**
`ws_package_course_order`, `ws_package_course_subscription(_tracking)`, `ws_pendrive_course*`, `ws_*_cart*`, `ws_package_course_ebook_price`, `ws_package_course_material`, `ws_exam_category_*`, `ws_material_category_*`. These reference catalog but are bought/owned data — migrate with commerce.

---

## 1. Schema state — GOOD (low drift)

Unlike address/offline, the catalog Prisma models match the live DDL:
- **`Video`**: `platform`, `youtube_id`, `aws_id`, `vimeo_id`, `type`(`priceType`), `status`, `vcategory_id`, `order_by` — all present, types match. ✅
- **`Package`**, **`Course`**, **`VideoCategory`**, **`PackageType`** Prisma models exist.

**To verify per-table during build** (the address/offline lesson): run `DESCRIBE` vs the Prisma model for each, checking (a) phantom columns, (b) Int vs BigInt on any phone/large-number, (c) NOT NULL columns the Mongo model omits. Video already checked clean.

---

## 2. The video-URL contract — LOWER RISK than expected ✅

The encryption is **isolated and DB-agnostic**:
- `src/client/course/lecture.controller.ts` → `encryptVideoSource(video)` uses `utils/videoEncryption` (`generateToken`/`generateKey`/`generateVector`/`encrypt`) on a `sourceId` picked by `platform` (`youtube_id`/`aws_id`/`vimeo_id`).
- The Prisma `Video` model **already exposes those exact fields**. So a migrated (Prisma) video read can feed the SAME object shape into the SAME `encryptVideoSource` → **identical token + videoURL by construction**.

**Contract rule for this module:** the MySQL video read must hand `encryptVideoSource` an object with `{ platform, youtube_id, aws_id, vimeo_id }` identical to the Mongo path. Do NOT reimplement encryption; reuse the util. Any endpoint returning video URLs (lecture, free, dashboard resume, etc.) must go through it.

---

## 3. Surface to migrate (per consumer)

- **`src/client/catalog/`** — catalog listing/browse (controller + routes)
- **`src/client/package/`** — package detail/listing
- **`src/client/course/`** — course detail (`course.controller`/`service`), **`lecture.controller`** (video URLs ⚠️), `progress.controller`, `resolveVideoCourse`/`resolveVideoScope`
- **Video reads** anywhere returning URLs: `lecture`, `src/client/free/*`, dashboard resume — all must use the shared encryption util on the migrated read.

**Decision needed (D1 — sub-scope/order):** catalog is large. Suggested safest-first sub-order:
1. **`package`** (+ `package_type`) — 4 rows, mostly metadata, no encryption. Lowest risk.
2. **`course`** (+ subject category) — 1 row; references packages.
3. **`video`** (+ `video_category`) — 156 rows; **the encryption contract** — do last, most carefully, with a token/URL parity check Mongo-vs-MySQL.

**Decision needed (D2 — video category relations):** `ws_video_category_package_relation` / `ws_video_category_relation` are M:N join tables. Migrate them with video, or treat as a follow-up if the client surface doesn't read them yet? (verify during build.)

---

## 4. ID-space coupling check (the address/offline lesson)

Catalog ids are referenced by commerce (orders/subscriptions reference package/course/video ids) and by
the dashboard. Since commerce stays Mongo this wave, check whether any **enabled** path joins a catalog id
across the DB boundary:
- Dashboard subscription/resume counts (still Mongo) read package/video ids.
- If a Mongo consumer reads a MySQL catalog id (int vs ObjectId), it breaks — same failure mode as the
  address/cart coupling. **Audit each catalog consumer before flipping**, and likely keep catalog flag OFF
  until its Mongo consumers are either migrated or branch-aware (mirrors the address deferral).

**Likely outcome:** build catalog dual-path now; **enabling** may need to wait for (or co-flip with)
the dashboard/commerce consumers — to be confirmed by the consumer audit in step 1 of the build.

---

## 5. Open decisions (before coding)

- **D1 — sub-order:** package → course → video (recommended), or different?
- **D2 — video category relations:** migrate with video, or follow-up?
- **D3 — enable strategy:** flip each sub-module as built, or build all three dual-path then flip together after a consumer audit (safer, mirrors address)?

---

## 6. Definition of done (per sub-module)

- [ ] Prisma model verified vs `DESCRIBE` (no drift / overflow / phantom cols)
- [ ] repository + service (dual-path) + transformer; controllers branched on `isMysqlModule("<key>")`
- [ ] **Video:** URL/token parity verified Mongo-vs-MySQL via the shared encryption util
- [ ] Consumer audit: no Mongo path joins a MySQL catalog id across the boundary (or co-flip planned)
- [ ] Registry + schema-comparison generators; api-tests; test log; tracker; README; regen docs
