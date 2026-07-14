-- 2026-07-14 — Study materials are ALWAYS paid (never a free tier)
--
-- Study materials (ws_material) are conceptually paid, gated PDFs — there is no
-- free tier (frontend removed the Paid/Free toggle; admin write now forces
-- isPaid=true). This one-time cleanup repairs any historical row still flagged
-- free so the data matches the rule.
--
-- The application ALSO enforces this as a hard rule at the read/gating layer
-- (client-material.getPurchasedMaterialIds + the material shapers treat every
-- material as paid, and /free-materials returns empty), so delivery is safe even
-- on an environment where this migration hasn't run yet. Running it keeps the
-- stored data honest and lets the column be trusted / deprecated later.
--
-- Idempotent / re-runnable.

UPDATE `ws_material`
SET `is_paid` = 1
WHERE `is_paid` = 0 OR `is_paid` IS NULL;

-- Verify (expect a single row: is_paid = 1):
--   SELECT is_paid, COUNT(*) FROM ws_material GROUP BY is_paid;
