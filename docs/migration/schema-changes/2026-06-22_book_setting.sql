-- Net-new table for the single book-settings config doc (Mongo BookSetting,
-- collection ws_book_settings) so /admin/books/settings serves from MySQL.
-- One row, keyed by setting_key='default'.
CREATE TABLE IF NOT EXISTS ws_book_setting (
  id                              INT NOT NULL AUTO_INCREMENT,
  setting_key                     VARCHAR(50)  NOT NULL DEFAULT 'default',
  free_shipping_min_order_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  support_phone                   VARCHAR(20)  NULL,
  terms_and_conditions            JSON         NULL,
  gst_rate                        DECIMAL(10,2) NOT NULL DEFAULT 0,
  origin_city                     VARCHAR(50)  NULL,
  origin_hub                      VARCHAR(100) NULL,
  created_at                      DATETIME     NULL,
  updated_at                      DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_book_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
