-- 2026-09-22 — Restore the missing column ws_exam.exam_category_id (nullable).
--
-- WHY: `yarn db:migrate` aborted on 2026-08-20_exam_category_nullable.sql with
--   ERROR 1054: Unknown column 'exam_category_id' in 'ws_exam'
-- Confirmed on that host: ws_exam has no `exam_category_id` column at all. The
-- 2026-08-20 file only WIDENS the column (NOT NULL → NULL); it cannot widen a column
-- that does not exist, and it is now guarded to no-op instead of stopping the run.
-- This file is the actual remediation for that host.
--
-- WHY THE COLUMN IS REQUIRED (it is not optional scaffolding): prisma/schema.prisma
-- models it —
--     model Exam {
--       ExamCategory   ExamCategory? @relation(fields: [examCategoryId], references: [id])
--       examCategoryId Int?          @map("exam_category_id")
--     }
-- — so Prisma names the column in the SELECT list of every full Exam read and in the
-- join behind `include: { ExamCategory: true }`. Without it, admin + client exam reads
-- fail at runtime with the same ERROR 1054, and the admin create/update path
-- (src/modules/admin-exam/admin-exam.service.ts — `examCategoryId: catId`) cannot
-- write the primary category at all. docs/migration/FIELD_COMPARISON.md records the
-- column as present (`int NOT NULL`) in the reference schema, so this host has drifted
-- from every other environment, not the other way round.
--
-- NULLABLE, not NOT NULL: this deliberately lands in the post-2026-08-20 shape
-- (category-less daily quizzes are legal — see that file's header). Adding it NULL also
-- needs no backfill and no DEFAULT, and makes 2026-08-20 a clean no-op afterwards.
--
-- NO BACKFILL: every existing row gets NULL. That is not a read regression — the
-- category read paths already match EITHER the direct column OR the pivot
-- (src/modules/catalog-exam/exam-category-pivot.where.ts ORs `{ examCategoryId: id }`
-- with `examCategoryPivot: { some: { categoryId: id } }`), and toExamDto maps a null
-- category to null. If you want the primary category back on the column for rows that
-- have pivot links, that is a separate, decidable data backfill — ask before running
-- one, because "primary" is not recoverable from the pivot alone (the pivot is seeded
-- FROM this column by scripts/seed-exam-category-pivot.ts, not the reverse).
--
-- NO FOREIGN KEY here, on purpose. The reference envs appear to carry
-- ws_exam.exam_category_id → ws_exam_category.id, but this repo's introspected schema
-- records no constraint name for that relation, so the name/actions cannot be
-- reproduced faithfully from what is checked in. Prisma joins on the column and does
-- not need the constraint at runtime. Add it separately if you want byte parity with
-- the other hosts.
--
-- NO POSITION CLAUSE (no `AFTER `type``): the column is appended. Placement is
-- cosmetic — it only affects the field order a future `yarn db:pull` writes — and an
-- AFTER clause would be one more column name this file asserts exists.
--
-- Non-destructive: adds a nullable column, touches no existing value. Safe to apply
-- before or with the code deploy.
--
-- Guarded so it is a no-op wherever the column already exists (i.e. everywhere else),
-- which is what lets it sit in the shared `yarn db:migrate` sequence. The no-op branch
-- is `DO 0` — never `SELECT "message"`, which a server whose sql_mode includes
-- ANSI_QUOTES parses as an identifier and rejects.

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_exam'
    AND COLUMN_NAME = 'exam_category_id'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `ws_exam` ADD COLUMN `exam_category_id` INT NULL',
  'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
