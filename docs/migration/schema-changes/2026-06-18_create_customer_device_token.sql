-- Net-new SQL table for multi-device FCM tokens — prerequisite (a) for enabling
-- the `client-notification` consumer. Mirrors Mongo's Customer.firebaseTokens[]
-- (an embedded array of { token, platform, updatedAt }) which has no SQL home:
-- ws_customer has only the single `device` (firebaseToken) column.
--
-- One row per (customer, token). `token` is globally UNIQUE so the same handset
-- re-registering under a different customer moves the row (matches the Mongo
-- two-step $pull-then-$push upsert, which is keyed on token). INT customer_id,
-- no hard FK (tolerates the 0/null owner sentinels seen elsewhere). Timestamps
-- nullable to mirror Mongo timestamps:true behaviour.

CREATE TABLE IF NOT EXISTS `ws_customer_device_token` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `customer_id`  INT NOT NULL,
  `token`        VARCHAR(512) NOT NULL,
  `platform`     VARCHAR(16) NULL,            -- 'ios' | 'android' | NULL
  `created_at`   DATETIME NULL,
  `updated_at`   DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_device_token` (`token`),
  KEY `idx_dt_customer` (`customer_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
