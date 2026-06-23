-- Adds a nullable `state` column to ws_offline_city so cities can be scoped by
-- state (State → City dependent dropdown). Matches prisma/schema.prisma:
--   model OfflineCity { state Int? @map("state")  State CustomerState? @relation(...) }
--
-- Run this against your MySQL DB BEFORE serving the new code (Prisma now selects
-- `state`, so city queries fail until the column exists).
--   Option A: apply this file directly (mysql < this.sql)
--   Option B: npx prisma db push   (syncs the schema; review the plan first)
--
-- After migrating, BACKFILL each city's state (admin City form, or UPDATEs below).
-- Cities left with state = NULL will NOT appear under any ?stateId= filter.

ALTER TABLE `ws_offline_city`
  ADD COLUMN `state` INT NULL AFTER `order`;

-- Optional FK (skip if engine/charset differ or you prefer app-level integrity only):
ALTER TABLE `ws_offline_city`
  ADD CONSTRAINT `fk_ws_offline_city_state`
  FOREIGN KEY (`state`) REFERENCES `ws_customer_state`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Example backfill (repeat per city, or join from your legacy source):
--   UPDATE `ws_offline_city` SET `state` = <ws_customer_state.id> WHERE `id` = <city_id>;
