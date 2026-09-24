# Rank Predictor

A student uploads their response sheet from a competitive exam. A Python service
reads the answers off the PDF, the backend scores them against the answer key an
admin published, and ranks the student against everyone else who uploaded for the
same paper.

This document covers how to operate it, what was changed to build it, and what
those changes touch.

---

## 1. The four projects

| Project | Path | Role |
|---|---|---|
| `websankul-ocr-service` | `~/Websankul/websankul-ocr-service` | The only Python service. PDF in, answers out. Has no database and no network egress. |
| `websankul-backend` | `~/Desktop/websankul-backend` | Models, APIs, auth, scoring, ranking. The hub. |
| `websankul-admin` | `~/Desktop/websankul-admin` | Admin panel — papers, answer keys, review queue. |
| `websankul-jobs` | `~/Websankul/websankul-jobs` | Student frontend. **Not yet cut over** — see §8. |

The old standalone platform at `~/Websankul/OCR` (its own Node API, Postgres, Redis
and admin console) is superseded by these and is scheduled for retirement.

---

## 2. Vocabulary

**Paper** — one competitive exam whose ranks we predict, e.g. *GPSC Prelims 2026*.
Called a Paper, not an Exam, because the panel already has **Exams / Quizzes**
(internal mock tests) and **Test Series**. Three things called "exam" in one sidebar
is how the wrong screen gets opened.

**Series** — a paper may be printed in parallel sets A/B/C/D with the questions
shuffled. Each set needs its own answer key. A paper with no series is one paper
everyone sat.

**Submission** — one student's uploaded sheet. One per student per paper.

**Answer key** — the correct option per question, plus the marking scheme.
Versioned: publishing a new key never edits the old one, so a score can always be
traced to the key that produced it.

> **Naming boundary, on purpose.** Everything an admin or an API client sees says
> *paper*: sidebar, URLs, permission keys. Everything at the storage layer says
> *exam*: the `ws_ocr_exams` table, the `OcrExam` Prisma model, and the `exam_id` /
> `exam_name` JSON fields. Renaming those would ripple into the Python service
> contract and the student frontend for no user-visible gain. If you are reading
> SQL and see `exam`, it is the same thing as a Paper.

---

## 3. How to use it

### 3.1 Create a paper

**Rank Predictor → Papers → Add Paper**

| Field | Notes |
|---|---|
| Paper Code | Goes in the student URL. Short and stable — `GPSC-2026`. |
| Paper Name | What students see. |
| Total Questions | **Must match the real paper exactly.** A sheet with a different count is rejected outright (§6). |
| Category | Groups papers on the student listing. |
| Paper Date | Optional. |
| Series | Leave empty if everyone sat the same paper. Pick A/B/C/D and each student must choose theirs when uploading, and **every letter needs its own key**. |
| Active | Off takes the paper off the student site completely: it leaves the listing, and its exam page, leaderboard and upload all answer `404`. Nothing is lost — switch it back on and everything returns. |

To remove a paper for good, use **Delete** in the papers table. It asks first,
because it also deletes every student's submission for that paper, their scores
and ranks, all its answer keys and the stored PDFs. There is no undo — switch
**Active** off instead if the data is worth keeping.

### 3.2 Publish the answer key — *this is the screen people cannot find*

The key is **not** on the Papers list. It is inside the paper:

```
Rank Predictor → Papers → click the paper → Answer Keys tab → Publish Key
```

The tab shows one card per series (or a single card for a series-less paper), each
reading **Published v3** or **Pending**. Nothing is scored while a card says
Pending — students can still upload, they just get no score and no rank.

Two ways to give the key, one per publish:

1. **Answer Key PDF** — upload the board's own key sheet. It goes through *the same
   extractor students' sheets go through*. That is the point: if it cannot read the
   key cleanly, that is the sheet layout it would have misread for every student,
   and you find out now rather than after publishing.
2. **Answer key CSV** — two columns, one row per question:

   ```csv
   question,answer
   1,3
   2,1
   ```

   Answers may be numbers (`1, 2, 3…`) or the letters boards actually print
   (`A, B, C…`, either case) — letters are converted to 1-based options on the
   way in. The file must cover every question on the paper; a short file is
   rejected naming the count, and a bad row is rejected naming the row number,
   because the file being fixed is usually a few hundred lines long.

   **Download blank template** writes one row per question with the answer
   column empty, ready to fill in a spreadsheet. **Download key** on a published
   card writes the live key the same way — correct it and upload it back to
   publish the next version. That round trip is the reason this is a CSV and not
   the JSON box it replaced: nobody hand-edits 210 questions of JSON without
   losing a brace.

   The CSV is parsed in the browser and sent as the `keys` object the API has
   always taken, so there is no CSV format on the server to keep in step.

Then the marking scheme:

- **Marks per correct answer** — usually `1`.
- **Negative marking** — enter it **positive**, e.g. `0.33` for one-third. It is
  subtracted for you.

Publishing again creates **v2** and retires v1 for that series automatically, and
re-scores every sheet already published for that series onto the new key (§4.2), so
no student is left ranked against a key that no longer exists.

> **Rolling back.** Retired versions are not clickable. Re-activating an old version
> would not roll anything back: scoring picks the *highest-numbered* active key, so
> v2 would keep winning while the UI showed two Active badges. To go back to an
> earlier key, publish it again as a new version.

### 3.3 Work the review queue

**Rank Predictor → Submissions**, which opens on **Needs review** — the sheets the
extractor was not confident enough to score by itself.

Click the eye icon. The modal shows the paper, the student (`ws_<id>`), roll number,
series, and the score if there is one. Then:

- **Open Sheet** — the original PDF, from a 15-minute signed URL. Sheets carry a roll
  number, so they are private and never publicly readable.
- **The flagged questions** — only the ones the extractor doubted are editable, one
  box each. Type the option number, or leave it empty to mark it unanswered.
  Everything else was read cleanly and is left alone.
- **Confirm & Re-score** — saves the corrections and scores the sheet in one step.

### 3.4 Re-score after a key correction

Open the submission and press **Re-score** (or *Re-score Without Changes*). It scores
against whichever key is active now.

There is no bulk "re-score this whole paper" action yet. That is the one operation
that genuinely wants a background job, and it is deliberately deferred until
synchronous extraction has been proven in production.

### 3.5 Read the leaderboard

**Papers → click the paper → Leaderboard tab.** Scored submissions only.

Admins see the student's **real name**, and clicking it opens that customer's profile.
Each row also says how the student appears to *other candidates* — masked, or real
because they opted in (a per-student toggle on the student frontend, stored in
`ws_ocr_profiles`). See §3.6 for why those are two different things.

Ties share a rank and the next rank skips — five candidates with two tied at 2nd read
1, 2, 2, 4, 5. Percentile is `(total − rank) / (total − 1) × 100`, so the top reads
100 and the last reads 0; a single candidate reads 100.

### 3.6 Who a sheet belongs to

Everywhere a student appears on the admin side — the review queue, the review modal,
the leaderboard tab — the name shown is the real one and clicking it opens
`/admin/customers/<id>`. The review queue also carries the phone number, because that
is how a student identifies themselves when they call about their sheet.

This is deliberately the opposite of what the student frontend does, and the
distinction is worth stating plainly:

| | Sees | Why |
|---|---|---|
| Another candidate | `Piy*** Pat***`, no id | Masking exists so candidates cannot identify each other from a public leaderboard |
| An admin | `Piyush Pathar`, phone, profile link | An admin correcting a sheet needs to know whose it is; they already have the whole customer table |

`show_real_name` is a promise made to other students, not to staff, so the admin
screens do not consult it — they only report it.

Structurally, the two shapes are separate types with separate producers:
`RankLeaderboardEntryDto` (masked, no id) and `RankAdminLeaderboardEntryDto` (real
name, with id), built by `toLeaderboardEntryDto` and `toAdminLeaderboardEntryDto`
respectively. A flag on one function would have let a client route emit the unmasked
shape by passing the wrong argument; two functions cannot. The same reasoning applies
to `RankCustomerDto`, which carries name/phone/email and is attached in the **admin
controllers only** — `rankPredictorService.getSubmission` is shared with the student's
own route, so it stays out of the service.

`ws_customer` is read here and never written: `findCustomersByIds` selects exactly
`id, full_name, phone, email_address`, in one query per page rather than one per row.
The narrow select is not just about payload size — `ws_customer` also holds
`password`, `otp` and `download_key_hex`, which must never reach a DTO.

### 3.7 Delete a student's sheet

**Submissions → the 🗑 button on the row → Delete submission.** For the wrong PDF,
the wrong series, a sheet stuck part-way through, or junk that should not sit in
the queue.

It is the one destructive thing on these screens, and it is irreversible: the
submission row, its score, its rank snapshot and the stored PDF are all removed.
The student drops off the leaderboard, the paper disappears from their *My ranks*,
and their one attempt is free again, so they can upload a new sheet. The
confirmation names the student, the paper and the score being destroyed.

**Why deleting, and not the old reset.** Until 2026-09-21 this button marked the
row `failed` with `failure_code = 'reset_by_admin'` and kept everything else. That
freed the attempt correctly — `status <> 'failed'` is what three separate places
mean by "this student has used their attempt":

| | Effect of removing the row |
|---|---|
| `active_customer_id` (STORED generated column) | the row is gone, so nothing occupies `uq_ocr_submissions_exam_active` |
| `findActiveSubmission` | finds nothing, so the next upload does not 409 `already_submitted` |
| `listMySubmissions` | lists nothing, so the paper disappears from the student's *My ranks* |

— but it left a "Failed" row in the queue that read like an extraction bug, and an
admin clearing out a bad sheet wants it gone. Deleting reaches the same three
outcomes by removing the row outright.

**What survives.** `ws_ocr_audit_logs` gets a `submission_deleted` row carrying the
previous status, the previous score, the exam, the customer and the PDF key. The
sheet itself cannot be restored, so the audit row is the whole record — read it
before assuming a student never uploaded.

**Permission:** `rank-predictor.submissions.delete`, deliberately **not** covered by
`rank-predictor.submissions.edit`. Correcting flagged answers and destroying
someone's sheet are different levels of trust, so a reviewer does not get the second
by being granted the first. Grant it explicitly per role. It replaces
`rank-predictor.submissions.reset`, which is now deprecated in `ws_permissions`.

> **Known gap:** the student is not notified. After a delete the paper simply
> disappears from their *My ranks* and the upload form reappears on the exam page.
> That is quiet rather than wrong, but telling them would need the notifications
> stack, which is out of scope here.

---

### 3.8 The three questions on a student's first visit

Before a student can use the Score & Rank Checker at all, they answer three
questions in a dialog they cannot dismiss:

1. **Caste category** — Open / SEBC / EWS / SC / ST
2. **Gender** — Male / Female
3. **Ex-servicemen** — Yes / No

There is no skip and no close button. The point of the gate is a complete set of
answers, and a skippable version collects them from nobody. It appears once: the
answers are saved on the student's own `ws_ocr_profiles` row
(`caste_category`, `gender`, `is_ex_serviceman`), so it never reappears on any
device, and a student who already has all three on file never sees it.

It is deliberately **not** shown to logged-out visitors. Browsing papers and
reading a leaderboard stays open to everyone — there is no row to save
against until they log in, and gating the acquisition funnel behind a form would
cost more than the data is worth. They meet it the moment they log in.

For a logged-in student the gate **fails closed**: it lifts only on answers read
back out of the database. If the profile read fails, the dialog stays up. The
cost of a bad minute on that endpoint is a student seeing the dialog again — not
an unanswered profile being waved through.

**Where the answers are stored, and why it is not where they belong.** These
three facts describe the person, not the attempt, so `ws_customer` was the right
home and `gender` already lived there. InnoDB would not have it: that table
carries a FULLTEXT index, which rules out both `INSTANT` and `INPLACE ADD
COLUMN` and leaves only a `COPY` rebuild that blocks writes on a table the
Laravel app also uses. So they sit on `ws_ocr_profiles` instead — our table,
keyed by `customer_id`, already holding the leaderboard name preference. If
`ws_customer` is ever rebuilt in a window, they move.

Nothing scores differently yet — category-wise rank is what this data is *for*,
and it is still §8 work. This is the collection step.

---

## 4. Where the student's answers meet the key

One pure function, no database and no IO, so it can be read on its own — which
matters, because this is the part a student will argue with.

**`src/modules/rank-predictor/rank-predictor.scoring.ts` → `buildAnswerReview()`**

```ts
Object.entries(answerKey).map(([questionNo, correctOption]) => {
  const chosen = answers[questionNo] ?? null;

  if (chosen === null) return { ..., verdict: "unanswered", marks: 0 };

  const isCorrect = chosen === correctOption;
  return {
    ...,
    verdict: isCorrect ? "correct" : "wrong",
    marks:   isCorrect ? scheme.marksCorrect : -scheme.marksWrong,
  };
})
```

It iterates **the answer key, not the student's answers**. A question the extractor
missed therefore counts as unanswered instead of vanishing from the total — the
denominator is always the key.

`scoreSubmission()` does not re-walk the key; it **tallies the array above**. There is
exactly one definition of "correct" in the file, so the totals a student is ranked on
and the per-question breakdown they are shown cannot drift apart.

The call chain:

```
POST /submissions              (student uploads)
  └─ service.createSubmission()
       ├─ row written as `processing` BEFORE extraction, so a crash leaves a
       │  visible record rather than a silent gap
       ├─ ocrExtractionClient.extractResponseSheet()   → Python service
       └─ service.scoreAndPublish()
            ├─ repo.findActiveAnswerKey(examId, series)
            ├─ scoreSubmission(answers, key.keys, { marksCorrect, marksWrong })  ← here
            ├─ repo.upsertScore(...)        → ws_ocr_scores  (this IS the leaderboard)
            ├─ repo.rankForExam(...)        → two COUNT(*) index probes
            └─ repo.upsertRankSnapshot(...) → ws_ocr_ranks   (audit only, never displayed)
```

`ws_ocr_ranks` is a snapshot for audit. What a student sees is always computed live,
because their rank moves every time anyone else uploads.

### 4.1 Showing the student which answers were right

**`GET /api/v1/client/rank-predictor/papers/:examId/review/me`**

Returns the caller's own sheet question by question — what they marked, what the key
says, the verdict, and the marks that question contributed. The exam detail page
renders it under the standing card (`RankAnswerReview.tsx` in websankul-jobs).

Three things about this endpoint are deliberate:

- **It is keyed on the session, not on a submission id.** There is no id in the path to
  tamper with, so it can only ever return the caller's own sheet. Contrast
  `/submissions/:id`, which has to check ownership explicitly.
- **It 404s (`not_scored`) until a score row exists.** A `needs_review` or `failed`
  sheet has no score, and a paper with no published key never produced one — so
  neither can be used to fish the key out.
- **It rebuilds the review from the key version the score references**
  (`ws_ocr_scores.answer_key_id`), not from whichever key is active now. The breakdown
  therefore always adds up to the marks the student was actually ranked on, even after
  an admin publishes a revision.

**This is the one student-facing route that returns correct answers, and it is the
single exception to the rule stated on `RankAnswerKeyAdminDto`.** The consequence is
worth being explicit about: *any student who uploads one sheet obtains the whole
published key for that paper.* That was accepted on the grounds that publishing a key
is already a declaration that it is public, and that a rank predictor which will not
show a student why they lost a mark is not worth much. If a key ever needs to stay
private while still being scored against, this endpoint is the thing to gate.

---

### 4.2 What happens when an answer key is updated

A score row stores its own correct/wrong/unanswered counts, while the review a
student reads is **recomputed** from their answers. If those two are ever allowed
to drift apart, the exam page contradicts itself — a score card reading
`Unanswered 0` above a breakdown showing 20 skipped. One invariant prevents it:

> A submission's score must always be derivable from its CURRENT answers and the
> key its score points at. Any path that changes either one re-scores or deletes.

It is enforced structurally, not by convention:

- A score row is written in exactly one place (`scoreAndPublish` → `upsertScore`)
  and deleted in exactly one place (the no-active-key branch of the same
  function). Nothing else in the module touches `ws_ocr_scores`.
- Every writer of `raw_answers` ends by calling `scoreAndPublish` — extraction on
  upload, and `confirmCorrections` after a review.
- `scoreAndPublish` refuses a sheet that is not `processed`, so a key edit can
  never publish one a human has not cleared (rule 4).
- **No active key no longer means "leave it alone."** An existing score at that
  point was computed from answers that have since changed, so it is deleted and
  an `submission_score_cleared` audit row written. Unranked is the honest state.

**Publishing a revised key re-scores the whole series.** Without it the
leaderboard would rank some students against v1 and others against v2, and the
admin would have no signal that it happened. `publishAnswerKey` and
`setAnswerKeyActive` both call `rescoreSeries`, which reports counts back in the
API message (`"Answer key published. 24 submission(s) rescored."`) and writes an
`answer_key_rescore` audit row. One sheet failing does not abandon the rest.

`setAnswerKeyActive` also activates **exclusively** — every sibling version for
the same series is retired in the same transaction, so an exam can never have two
keys flagged active with the winner decided implicitly by version order.

> **Scale.** `rescoreSeries` runs inline. That is correct for a paper with
> hundreds of entries and wrong at tens of thousands — it is the one operation
> here that genuinely wants a queue (see §8). Moving it needs a decision about
> BullMQ and has deliberately not been made.

---

## 5. What changed, by repo

### 5.1 `websankul-backend`

**New — the module** (`src/modules/rank-predictor/`), the mandated file split, with
Prisma confined to the repository:

| File | Holds |
|---|---|
| `rank-predictor.types.ts` | DTOs and the extraction result contract |
| `rank-predictor.validation.ts` | Zod schemas only |
| `rank-predictor.repository.ts` | All Prisma. Ranking via two raw `COUNT(*)` probes |
| `rank-predictor.scoring.ts` | Pure arithmetic — §4 |
| `rank-predictor.service.ts` | All business rules |
| `rank-predictor.transformer.ts` | Row → DTO |

**New — HTTP:**

- `src/admin/rank-predictor/` — `rank-predictor.routes.ts` (aggregator),
  `papers.{routes,controller}.ts`, `answerKeys.controller.ts`,
  `submissions.{routes,controller}.ts`
- `src/client/rank-predictor/` — `rank-predictor.{routes,controller}.ts`

**New — supporting:**

- `src/config/ocrService.ts` — config for the Python service
- `src/utils/ocrExtractionClient.ts` — the **only** module that talks to Python
- `src/utils/rankSheetStorage.ts` — private uploads, `ACL: "private"`, signed GET, 15-min TTL

**Modified:**

| File | Change |
|---|---|
| `prisma/schema.prisma` | +184 lines, **0 deletions**. Seven models, three enums. `Customer` untouched; `OcrProfile` since gained the three candidate columns — see §3.8 |
| `docs/migration/schema-changes/2026-09-20_ocr_rank_predictor_tables.sql` | New, additive, idempotent |
| `src/admin/admin.routes.ts` | Mount `/rank-predictor` |
| `src/client/client.routes.ts` | Mount, before the catch-alls |
| `src/admin/permission/permissions.catalog.ts` | Three `mod()` entries (papers and submissions carry `delete`), `CATALOG_VERSION` → `2026.09.21-4` |
| `src/middlewares/rbacRouteMap.ts` | Route → permission rules |
| `src/middlewares/upload.ts` | `uploadRankPdfToMemory` — memoryStorage, 25 MB, PDF only |
| `src/config/env.ts`, `.env.example` | `OCR_*` variables |

### 5.2 `websankul-admin`

**New — two features, 18 files:**

```
src/features/rankPapers/
  api/rankPapers.service.ts
  store/rankPapersSlice.ts  + .test.ts
  hooks/useRankPapers.ts
  pages/RankPapersList/  index.tsx, RankPaperTable, AddRankPaperModal
  pages/RankPaperDetail/ index.tsx, AnswerKeysTab, PublishAnswerKeyModal, LeaderboardTab

src/features/rankSubmissions/
  api/rankSubmissions.service.ts
  store/rankSubmissionsSlice.ts + .test.ts
  hooks/useRankSubmissions.ts
  pages/RankSubmissionsList/ index.tsx, RankSubmissionTable, RankSubmissionDetailModal
```

**Modified — five registration files, 64 insertions, 0 deletions:**

| File | Change |
|---|---|
| `src/api/endpoints.ts` | `rankPredictor` endpoint block |
| `src/store/index.ts` | `rankPapers`, `rankSubmissions` reducers |
| `src/app/routes.tsx` | Three routes |
| `src/layouts/components/data.ts` | Sidebar section |
| `src/features/auth/rbac/modulePermissions.ts` | Two path → permission entries |

### 5.3 `websankul-ocr-service`

Hardened separately. Also had four dead config variables removed — `OPENAI_API_KEY`
and three `AI_VERIFY_*` — that no code ever read. The `OPENAI_API_KEY` that was
committed in `.env.example` **must be revoked**; it is still reachable in git history.

---

## 6. What it affects

**Nothing existing changes.** No existing table is altered, no existing model edited,
no existing route moved. Every change is additive. Specifically:

- **`ws_customer` is untouched — completely.** Not altered, not locked, not
  referenced. `customer_id` on `ws_ocr_submissions`, `ws_ocr_scores` and
  `ws_ocr_profiles` is a plain indexed `int` with **no foreign key** and no Prisma
  relation.

  Proof: the migration was applied to a scratch database in which `ws_customer` does
  not exist, and all seven tables were created without error. Every remaining foreign
  key points at another `ws_ocr_*` table.

  **The cost, stated plainly:** the database will no longer refuse a `customer_id`
  that does not exist, so an orphan row is possible if application code writes a bad
  id. That guarantee now lives in the service, which only ever writes `req.user.id` —
  a customer that has just authenticated.

  **What this buys:** adding these tables takes no metadata lock on `ws_customer`, and
  `DELETE FROM ws_customer` keeps behaving exactly as it does today instead of
  starting to fail for any student who uploaded a sheet.

  → `db pull` cannot re-add the relations (there is no FK to find), but it **will**
  surface `active_customer_id`, a STORED generated column that must stay out of the
  model or every `create()` will try to write it. Flagged in `schema.prisma`.

- **Permissions.** `CATALOG_VERSION` bumped, so the seeder syncs `ws_permissions` on
  next boot. Three new modules appear under a **Rank Predictor** group:

  | Module | Actions |
  |---|---|
  | `rank-predictor.papers` | view, create, edit, delete, toggle-status — **delete cascades**: `DELETE /admin/rank-predictor/papers/:id` removes the paper together with every submission, score, rank, answer key and stored PDF under it, and is not reversible. `toggle-status` is the reversible way to take a paper off the student surface |
  | `rank-predictor.answer-keys` | view, create, toggle-status — keys are published and retired, never edited or deleted |
  | `rank-predictor.submissions` | view, edit, delete — a student's own work, never created by an admin; `delete` removes the sheet, its score, its rank and its PDF, and frees the attempt |

  Existing roles gain nothing automatically. Grant the keys to whoever needs them.

- **Load.** Extraction is synchronous and inline. A large sheet takes tens of seconds,
  so the **load balancer idle timeout must be ≥ 60s** on the upload route.

- **Storage.** Sheets go to the private bucket with `ACL: "private"`. They carry roll
  numbers; do not make them public.

### Rules the backend enforces

1. One non-failed submission per student per paper → `409 already_submitted`,
   enforced by a DB unique index on a generated column, so two parallel uploads
   cannot both win.
2. A failed sheet does **not** burn the attempt — the student can retry.
3. Series required when the paper has any → `400 series_required` with `allowed_series`.
4. Question-count mismatch → `422 question_count_mismatch`, submission marked failed.
5. Too many low-confidence answers → `needs_review`. **Never scored, never on the
   leaderboard** until a human confirms.
6. No active key → `200` with `warning: "no_active_answer_key"`. A warning, not an error.
7. Every score-affecting action writes a row to `ws_ocr_audit_logs`.
8. An inactive paper (`is_active = false`) is invisible on the client surface:
   it is filtered out of `GET /papers`, and `/papers/:id`, its leaderboard and
   its upload endpoint all answer `404`. The client cannot ask for inactive
   papers — the public listing ignores an `isActive` query param entirely.
9. Deleting a paper deletes its submissions, scores, ranks, answer keys and
   stored PDFs, in that order, inside one transaction, and writes an
   `exam_deleted` audit row recording the counts.

---

## 7. Deploying

The seven tables do not exist in production yet. **This is the only thing standing
between the current code and a working panel** — without them every list 500s with
`PRISMA SCHEMA DRIFT [DDL_MISSING] ws_ocr_exams`.

> ### Do NOT use `yarn db:migrate` for this
>
> `scripts/apply-ddl.ts` replays **every** file in `docs/migration/schema-changes/`
> that is not recorded in the `_ddl_migrations` ledger. That directory holds **135**
> files, and a number of them are destructive — `2026-07-17_drop_stale_tables.sql`,
> `2026-07-08_drop_pendrive_course.sql`, `2026-07-16_drop_customer_device_token.sql`,
> `2026-07-01_migrate_ws_goal_into_target_goal.sql`, among others.
>
> If production's ledger is missing or incomplete — and it is not tracked in git, so a
> checkout cannot tell you — that command replays those DROPs against the live
> database. Apply this one file by name instead.

```bash
cd ~/Desktop/websankul-backend

# 1. Create the tables. Additive and idempotent — re-running is a no-op.
#    One file, by name. NOT `yarn db:migrate` — see the warning above.
npx prisma db execute \
  --file docs/migration/schema-changes/2026-09-20_ocr_rank_predictor_tables.sql \
  --schema prisma/schema.prisma

# 2. Verify — expect 7 rows.
#    ws_ocr_answer_keys, ws_ocr_audit_logs, ws_ocr_exams, ws_ocr_profiles,
#    ws_ocr_ranks, ws_ocr_scores, ws_ocr_submissions
mysql -h <host> -u <user> -p <db> -e "SHOW TABLES LIKE 'ws_ocr%';"

# 3. Regenerate the client and restart. The permission seeder runs on boot and
#    picks up CATALOG_VERSION 2026.09.21-3.
yarn prisma:generate
```

Then: grant the three `rank-predictor.*` modules to the roles that need them, and set
`OCR_SERVICE_URL` / `OCR_INTERNAL_TOKEN` so the backend can reach the Python service.

**Rollback** is `DROP TABLE` on the seven `ws_ocr_*` tables. Nothing else references
them, so nothing else breaks.

> **The local `websankul_staging` database is not a substitute.** It is an old dump —
> 96 tables against a Prisma schema that has moved well past it. Booting against it
> fails on `ws_permission_category`, `ws_notification` and `ws_pdf_upload_job`, so the
> panel cannot even authenticate. Running the module locally means bringing that dump
> up to date first.

---

## 8. Not done yet

- **Student frontend cutover** (`websankul-jobs`). It still talks to the old OCR API
  through a service-key bridge that fakes student identity via `x-rank-user-id`.
  Repointing it at this backend with a real Bearer token, and deleting that bridge,
  is the remaining work.
- **Retiring `~/Websankul/OCR`** — `pg_dump` and archive first.
- **Bulk re-score** after a key revision (§3.4).
- **`setAnswerKeyActive` does not deactivate siblings.** `publishAnswerKey` does it in
  a transaction; the status toggle does not. The admin panel works around this by
  refusing to re-activate retired versions, but the backend should do it properly.
- **Revoke the leaked `OPENAI_API_KEY`** (§5.3).
