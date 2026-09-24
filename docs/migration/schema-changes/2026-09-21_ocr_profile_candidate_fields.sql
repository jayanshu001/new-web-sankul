ALTER TABLE `ws_ocr_profiles`
  ADD COLUMN `caste_category`   varchar(10) DEFAULT NULL COMMENT 'open|sebc|ews|sc|st — reservation category, asked by the first-visit gate',
  ADD COLUMN `gender`           varchar(10) DEFAULT NULL COMMENT 'male|female — asked by the first-visit gate; ws_customer.gender is left untouched',
  ADD COLUMN `is_ex_serviceman` tinyint(1)  DEFAULT NULL COMMENT '1 = ex-servicemen quota; NULL = never asked',
  ALGORITHM=INSTANT;
