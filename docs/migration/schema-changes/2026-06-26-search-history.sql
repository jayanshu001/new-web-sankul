-- Recent Search History (client global search)
-- Stores the latest search terms per customer. App layer keeps only the
-- newest 10 rows per customer (trim-on-write). The UNIQUE (customer_id, query)
-- pair powers dedupe / move-to-top: re-searching an existing term refreshes
-- its created_at via upsert instead of inserting a duplicate row.

CREATE TABLE IF NOT EXISTS `ws_search_history` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NOT NULL,
  `query`       VARCHAR(255) NOT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_search_history_customer_query` (`customer_id`, `query`),
  KEY `idx_search_history_customer_created` (`customer_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
