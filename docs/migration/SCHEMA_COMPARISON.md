# Schema comparison — Legacy MySQL vs MongoDB vs post-migration MySQL

> **Generated:** 2026-06-06 (re-run `yarn docs:schema-comparison` after schema changes)  
> **Migrated only:** [MIGRATED_MODULES.md](./MIGRATED_MODULES.md) · **Field-level detail:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md)  
> **Sources:** `websankul_staging.sql`, `prisma/schema.prisma`, `src/models/**/*.model.ts`  
> **Strategy:** [legacy_system_migration_strategy.md](./legacy_system_migration_strategy.md)

---

## How to read this document

| Column | Meaning |
|--------|---------|
| **Legacy MySQL** | Production/staging table from Laravel + old API (`websankul-api-staging`) |
| **MongoDB collection** | Current `new-web-sankul` Mongoose storage (intermediate rewrite) |
| **Post-migration MySQL** | Target table used by Prisma after Phase 2+ (usually **same name** as legacy) |
| **Status** | Whether the module already reads/writes MySQL via `MIGRATION_MYSQL_MODULES` |

### Common patterns

| Pattern | Example | Migration note |
|---------|---------|----------------|
| Singular vs plural table | `ws_faq` vs `ws_faqs` | Prisma maps to **legacy singular** table |
| Int PK vs ObjectId | `id` int vs `_id` ObjectId | API transformers expose `_id` as string for admin |
| Typo preserved | `isUpdateAvailble`, `ws_refferal_*` | Keep column names; fix in API layer only |
| MySQL enum vs Mongo ref | `ws_faq.type` enum vs `typeId` ObjectId | Transformer + validation per module |
| Mongo-only feature | `ws_live_courses`, `ws_test_series` | Needs new MySQL tables or stay on Mongo until designed |

### Currently migrated modules (`MIGRATION_MYSQL_MODULES`)

`app-update, version, faq, banner-slider, testimonial, department, terms, popup`

---

## Master inventory (table / collection)

| # | Domain (model) | Legacy MySQL (staging dump) | MongoDB collection (new app) | Post-migration MySQL (Prisma) | Status | Notes |
|---:|---|---|---|---|---|---|
| 1 | AppUpdate | `ws_app_update` (4 cols) | `ws_app_updates` | `ws_app_update` | ✅ Migrated | Collection name differs from MySQL table |
| 2 | BannerSlider | `ws_banner_slider` (7 cols) | `ws_banner_sliders` | `ws_banner_slider` | ✅ Migrated | Collection name differs from MySQL table |
| 3 | Book | `ws_book` (20 cols) | `ws_books` | `ws_book` | ⏳ Not migrated | Collection name differs from MySQL table |
| 4 | BookCart | `ws_book_cart` (11 cols) | `ws_book_carts` | `ws_book_cart` | ⏳ Not migrated | Collection name differs from MySQL table |
| 5 | BookCartItem | `ws_book_cart_item` (7 cols) | — | `ws_book_cart_item` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 6 | BookOrder | `ws_book_order` (19 cols) | `ws_book_orders` | `ws_book_order` | ⏳ Not migrated | Collection name differs from MySQL table |
| 7 | BookOrderItem | `ws_book_order_item` (9 cols) | — | `ws_book_order_item` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 8 | BookTracking | `ws_book_tracking` (5 cols) | — | `ws_book_tracking` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 9 | Course | `ws_course` (19 cols) | — | `ws_course` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 10 | CourseEducator | `ws_course_educator` (12 cols) | — | `ws_course_educator` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 11 | CourseSubjectCategory | `ws_course_subject_category` (9 cols) | — | `ws_course_subject_category` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 12 | Customer | `ws_customer` (34 cols) | `ws_customers` | `ws_customer` | ⏳ Not migrated | Collection name differs from MySQL table |
| 13 | CustomerAccessToken | `ws_customer_access_token` (8 cols) | `ws_customer_access_tokens` | `ws_customer_access_token` | ⏳ Not migrated | Collection name differs from MySQL table |
| 14 | CustomerAddress | `ws_customer_address` (14 cols) | `ws_customer_addresses` | `ws_customer_address` | ⏳ Not migrated | Collection name differs from MySQL table |
| 15 | CustomerBankAccount | `ws_customer_bank_account` (7 cols) | `ws_customer_bank_accounts` | `ws_customer_bank_account` | ⏳ Not migrated | Collection name differs from MySQL table |
| 16 | CustomerDistict | `ws_customer_distict` (4 cols) | — | `ws_customer_distict` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 17 | CustomerEducation | `ws_customer_education` (3 cols) | `ws_customer_educations` | `ws_customer_education` | ⏳ Not migrated | Collection name differs from MySQL table |
| 18 | CustomerOtp | `ws_customer_otp` (4 cols) | `ws_customer_otps` | `ws_customer_otp` | ⏳ Not migrated | Collection name differs from MySQL table |
| 19 | CustomerShipping | `ws_customer_shipping` (14 cols) | `ws_customer_shippings` | `ws_customer_shipping` | ⏳ Not migrated | Collection name differs from MySQL table |
| 20 | CustomerState | `ws_customer_state` (4 cols) | `ws_customer_states` | `ws_customer_state` | ⏳ Not migrated | Collection name differs from MySQL table |
| 21 | CustomerTargetGoal | `ws_customer_target_goal` (4 cols) | `ws_customer_target_goals` | `ws_customer_target_goal` | ⏳ Not migrated | Collection name differs from MySQL table |
| 22 | Department | `ws_department` (5 cols) | `ws_departments` | `ws_department` | ✅ Migrated | Collection name differs from MySQL table |
| 23 | DepartmentContact | `ws_department_contact` (7 cols) | — | `ws_department_contact` | ✅ Migrated | MySQL/Prisma only (no Mongoose model found) |
| 24 | DynamicImage | `ws_dynamic_image` (2 cols) | `ws_dynamic_images` | `ws_dynamic_image` | ⏳ Not migrated | Collection name differs from MySQL table |
| 25 | EBook | `ws_ebook` (16 cols) | `ws_ebook_downloads` | `ws_ebook` | ⏳ Not migrated | Collection name differs from MySQL table |
| 26 | EBookOrder | `ws_ebook_order` (16 cols) | — | `ws_ebook_order` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 27 | EBookSubscription | `ws_ebook_subscription` (12 cols) | — | `ws_ebook_subscription` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 28 | Exam | `ws_exam` (18 cols) | `ws_exam` | `ws_exam` | ⏳ Not migrated |  |
| 29 | ExamCategory | `ws_exam_category` (9 cols) | `ws_exam` | `ws_exam_category` | ⏳ Not migrated | Collection name differs from MySQL table |
| 30 | ExamCategoryCourse | `ws_exam_category_course` (6 cols) | `ws_exam` | `ws_exam_category_course` | ⏳ Not migrated | Collection name differs from MySQL table |
| 31 | ExamCategoryPackage | `ws_exam_category_package` (6 cols) | `ws_exam` | `ws_exam_category_package` | ⏳ Not migrated | Collection name differs from MySQL table |
| 32 | ExamQuestion | `ws_exam_question` (11 cols) | `ws_exam_question` | `ws_exam_question` | ⏳ Not migrated |  |
| 33 | ExamQuestionOption | `ws_exam_question_option` (5 cols) | `ws_exam_question_option` | `ws_exam_question_option` | ⏳ Not migrated |  |
| 34 | ExamResult | `ws_exam_result` (14 cols) | `ws_exam_result` | `ws_exam_result` | ⏳ Not migrated |  |
| 35 | ExamResultDetail | `ws_exam_result_detail` (8 cols) | `ws_exam_result_detail` | `ws_exam_result_detail` | ⏳ Not migrated |  |
| 36 | ExamResultDetailAnalytics | `ws_exam_result_detail_analytics` (9 cols) | `ws_exam_result_detail_analytics` | `ws_exam_result_detail_analytics` | ⏳ Not migrated |  |
| 37 | — | `ws_failed_jobs` (7 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 38 | FAQ | `ws_faq` (7 cols) | `ws_faqs` | `ws_faq` | ✅ Migrated | Collection name differs from MySQL table |
| 39 | ImageNotification | `ws_image_notification` (4 cols) | `ws_image_notifications` | `ws_image_notification` | ⏳ Not migrated | Collection name differs from MySQL table |
| 40 | Material | `ws_material` (9 cols) | `ws_materials` | `ws_material` | ⏳ Not migrated | Collection name differs from MySQL table |
| 41 | MaterialCategory | `ws_material_category` (9 cols) | — | `ws_material_category` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 42 | MaterialCategoryCourse | `ws_material_category_course` (6 cols) | — | `ws_material_category_course` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 43 | MaterialCategoryPackage | `ws_material_category_package` (6 cols) | — | `ws_material_category_package` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 44 | — | `ws_migrations` (3 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 45 | — | `ws_model_has_permissions` (3 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 46 | — | `ws_model_has_roles` (3 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 47 | OfflineBannerSlider | `ws_offline_banner_slider` (6 cols) | `ws_offline_banner_slider` | `ws_offline_banner_slider` | ⏳ Not migrated |  |
| 48 | OfflineBatch | `ws_offline_batch` (9 cols) | `ws_offline_batch` | `ws_offline_batch` | ⏳ Not migrated |  |
| 49 | OfflineCenter | `ws_offline_center` (10 cols) | `ws_offline_center` | `ws_offline_center` | ⏳ Not migrated |  |
| 50 | OfflineCity | `ws_offline_city` (5 cols) | `ws_offline_city` | `ws_offline_city` | ⏳ Not migrated |  |
| 51 | OfflineEnquiry | `ws_offline_enquiry` (8 cols) | `ws_offline_enquiry` | `ws_offline_enquiry` | ⏳ Not migrated |  |
| 52 | Package | `ws_package` (15 cols) | `ws_packages` | `ws_package` | ⏳ Not migrated | Collection name differs from MySQL table |
| 53 | chat | `ws_package_chat` (5 cols) | `ws_package_chats` | `ws_package_chat` | ⏳ Not migrated | Collection name differs from MySQL table |
| 54 | PackageCourseEbookPrice | `ws_package_course_ebook_price` (13 cols) | — | `ws_package_course_ebook_price` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 55 | PackageCourseMaterial | `ws_package_course_material` (4 cols) | — | `ws_package_course_material` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 56 | PackageCourseOrder | `ws_package_course_order` (22 cols) | — | `ws_package_course_order` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 57 | PackageCourseSubscription | `ws_package_course_subscription` (21 cols) | — | `ws_package_course_subscription` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 58 | PackageCourseSubscriptionTracking | `ws_package_course_subscription_tracking` (5 cols) | — | `ws_package_course_subscription_tracking` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 59 | PackageSpecificSubject | `ws_package_specific_subject` (7 cols) | — | `ws_package_specific_subject` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 60 | PackageType | `ws_package_type` (4 cols) | `ws_package_types` | `ws_package_type` | ⏳ Not migrated | Collection name differs from MySQL table |
| 61 | — | `ws_password_resets` (4 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 62 | PendriveCourse | `ws_pendrive_course` (24 cols) | — | `ws_pendrive_course` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 63 | PendriveCourseCart | `ws_pendrive_course_cart` (5 cols) | — | `ws_pendrive_course_cart` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 64 | PendriveCourseCartItem | `ws_pendrive_course_cart_item` (3 cols) | — | `ws_pendrive_course_cart_item` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 65 | PendriveCourseOrder | `ws_pendrive_course_order` (16 cols) | — | `ws_pendrive_course_order` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 66 | PendriveCourseStorageDevice | `ws_pendrive_course_storage_device` (5 cols) | — | `ws_pendrive_course_storage_device` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 67 | PendriveCourseTag | `ws_pendrive_course_tag` (5 cols) | — | `ws_pendrive_course_tag` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 68 | PendriveCourseTracking | `ws_pendrive_course_tracking` (5 cols) | — | `ws_pendrive_course_tracking` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 69 | Permission | `ws_permissions` (5 cols) | `ws_permissions` | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 70 | — | `ws_personal_access_tokens` (10 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 71 | PopupNotifications | `ws_popup_notification` (10 cols) | `ws_popup_notifications` | `ws_popup_notification` | ✅ Migrated | Collection name differs from MySQL table |
| 72 | Promocode | `ws_promocode` (13 cols) | — | `ws_promocode` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 73 | PromotedPackageCourseEbook | `ws_promoted_package_course_ebook` (10 cols) | — | `ws_promoted_package_course_ebook` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 74 | Promoter | `ws_promoter` (11 cols) | `ws_promoter` | `ws_promoter` | ⏳ Not migrated |  |
| 75 | RefferalProgram | `ws_refferal_program` (10 cols) | — | `ws_refferal_program` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 76 | RefferalTransaction | `ws_refferal_transaction` (10 cols) | — | `ws_refferal_transaction` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 77 | — | `ws_role_has_permissions` (2 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 78 | Role | `ws_roles` (5 cols) | `ws_roles` | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 79 | — | `ws_tag` (5 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 80 | TermsAndConditions | `ws_termsandcondition` (5 cols) | — | `ws_termsandcondition` | ✅ Migrated | MySQL/Prisma only (no Mongoose model found) |
| 81 | Testimonial | `ws_testimonial` (5 cols) | `ws_testimonials` | `ws_testimonial` | ✅ Migrated | Collection name differs from MySQL table |
| 82 | — | `ws_user_inquiry` (10 cols) | — | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 83 | AdminUser | `ws_users` (15 cols) | `ws_users` | — | ⏳ Not migrated | In SQL dump but no Prisma model |
| 84 | Version | `ws_versions` (3 cols) | `ws_versions` | `ws_versions` | ✅ Migrated |  |
| 85 | Video | `ws_video` (14 cols) | — | `ws_video` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 86 | VideoCategory | `ws_video_category` (11 cols) | — | `ws_video_category` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 87 | PackageVideoCategoryRelation | `ws_video_category_package_relation` (6 cols) | — | `ws_video_category_package_relation` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 88 | VideoCategoryRelation | `ws_video_category_relation` (6 cols) | — | `ws_video_category_relation` | ⏳ Not migrated | MySQL/Prisma only (no Mongoose model found) |
| 89 | Inquiry | `ws_website_inquiry` (9 cols) | `ws_website_inquiry` | `ws_website_inquiry` | ⏳ Not migrated |  |
| 90 | Goal | — | `(default goals)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/Goal.model.ts |
| 91 | AdminAccessToken | — | `ws_admin_access_tokens` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/admin/AdminAccessToken.model.ts |
| 92 | PermissionCategory | — | `ws_permission_categories` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/admin/PermissionCategory.model.ts |
| 93 | BookSetting | — | `ws_book_settings` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/book/BookSetting.model.ts |
| 94 | Counter | — | `ws_counters` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/book/Counter.model.ts |
| 95 | Course | — | `(default courses)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/Course.model.ts |
| 96 | CourseEducator | — | `(default courseeducators)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/CourseEducator.model.ts |
| 97 | CourseSubjectCategory | — | `(default coursesubjectcategorys)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/CourseSubjectCategory.model.ts |
| 98 | LiveChatBan | — | `ws_live_chat_bans` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/LiveChatBan.model.ts |
| 99 | LiveChatMessage | — | `ws_live_chat_messages` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/LiveChatMessage.model.ts |
| 100 | LiveCourse | — | `ws_live_courses` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/LiveCourse.model.ts |
| 101 | LiveCoursePlan | — | `ws_live_course_plans` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/LiveCoursePlan.model.ts |
| 102 | LivePoll | — | `ws_live_polls` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/LivePoll.model.ts |
| 103 | LivePollVote | — | `ws_live_poll_votes` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/LivePollVote.model.ts |
| 104 | LiveSession | — | `ws_live_sessions` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/LiveSession.model.ts |
| 105 | MaterialCategory | — | `(default materialcategorys)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/MaterialCategory.model.ts |
| 106 | PackageCategory | — | `(default packagecategorys)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/PackageCategory.model.ts |
| 107 | PackageCourseEbookPrice | — | `(default packagecourseebookprices)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/PackageCourseEbookPrice.model.ts |
| 108 | PackageCourseMaterial | — | `(default packagecoursematerials)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/PackageCourseMaterial.model.ts |
| 109 | PackageVideoCategoryRelation | — | `ws_package_video_category_relations` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/PackageVideoCategoryRelation.model.ts |
| 110 | PromoCode | — | `(default promocodes)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/PromoCode.model.ts |
| 111 | PromotedPackageCourseEbook | — | `(default promotedpackagecourseebooks)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/PromotedPackageCourseEbook.model.ts |
| 112 | Video | — | `(default videos)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/Video.model.ts |
| 113 | VideoCategory | — | `(default videocategorys)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/VideoCategory.model.ts |
| 114 | VideoCategoryRelation | — | `(default videocategoryrelations)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/course/VideoCategoryRelation.model.ts |
| 115 | CustomerDistrict | — | `ws_customer_districts` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/CustomerDistrict.model.ts |
| 116 | Folder | — | `ws_folders` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/Folder.model.ts |
| 117 | FolderItem | — | `ws_folder_items` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/FolderItem.model.ts |
| 118 | LectureAudioNote | — | `ws_lecture_audio_notes` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/LectureAudioNote.model.ts |
| 119 | LectureNote | — | `ws_lecture_notes` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/LectureNote.model.ts |
| 120 | LectureProgress | — | `ws_lecture_progress` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/LectureProgress.model.ts |
| 121 | LiveCourseSubscription | — | `ws_live_course_subscriptions` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/LiveCourseSubscription.model.ts |
| 122 | LiveSessionAttendance | — | `ws_live_session_attendance` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/LiveSessionAttendance.model.ts |
| 123 | LiveSessionPreview | — | `ws_live_session_previews` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/LiveSessionPreview.model.ts |
| 124 | LiveSessionReminder | — | `(default livesessionreminders)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/LiveSessionReminder.model.ts |
| 125 | PackageCourseSubscription | — | `(default packagecoursesubscriptions)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/PackageCourseSubscription.model.ts |
| 126 | Wishlist | — | `ws_wishlists` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/customer/Wishlist.model.ts |
| 127 | Ebook | — | `(default ebooks)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/ebook/Ebook.model.ts |
| 128 | EbookOrder | — | `(default ebookorders)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/ebook/EbookOrder.model.ts |
| 129 | EbookPrice | — | `(default ebookprices)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/ebook/EbookPrice.model.ts |
| 130 | EbookSubscription | — | `(default ebooksubscriptions)` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/ebook/EbookSubscription.model.ts |
| 131 | EducatorAccessToken | — | `ws_educator_access_tokens` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/educator/EducatorAccessToken.model.ts |
| 132 | ExamCategory | — | `ws_exam_categories` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/exam/ExamCategory.model.ts |
| 133 | ExamCountdown | — | `ws_exam_countdowns` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/examCountdown/ExamCountdown.model.ts |
| 134 | ExamCountdownCategory | — | `ws_exam_countdown_categories` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/examCountdown/ExamCountdownCategory.model.ts |
| 135 | PromoterAccessToken | — | `ws_promoter_access_tokens` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/promoter/PromoterAccessToken.model.ts |
| 136 | ReferralFaq | — | `ws_referral_faqs` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/referral/ReferralFaq.model.ts |
| 137 | ReferralProgram | — | `ws_referral_programs` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/referral/ReferralProgram.model.ts |
| 138 | ReferralTerm | — | `ws_referral_terms` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/referral/ReferralTerm.model.ts |
| 139 | ReferralTransaction | — | `ws_referral_transactions` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/referral/ReferralTransaction.model.ts |
| 140 | ActivityLog | — | `ws_activity_log` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/system/ActivityLog.model.ts |
| 141 | FaqType | — | `ws_faq_types` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/system/FaqType.model.ts |
| 142 | LiveBannerSlider | — | `ws_live_banner_sliders` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/system/LiveBannerSlider.model.ts |
| 143 | Notification | — | `ws_notifications` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/system/Notification.model.ts |
| 144 | SocialLink | — | `ws_social_links` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/system/SocialLink.model.ts |
| 145 | SocialLinkType | — | `ws_social_link_types` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/system/SocialLinkType.model.ts |
| 146 | TermsAndConditions | — | `ws_terms_and_conditions` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/system/TermsAndConditions.model.ts |
| 147 | TestSeries | — | `ws_test_series` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/testSeries/TestSeries.model.ts |
| 148 | TestSeriesContentCategory | — | `ws_test_series_content_category` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/testSeries/TestSeriesContentCategory.model.ts |
| 149 | TestSeriesExam | — | `ws_test_series_exam` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/testSeries/TestSeriesExam.model.ts |
| 150 | TestSeriesOrder | — | `ws_test_series_orders` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/testSeries/TestSeriesOrder.model.ts |
| 151 | TestSeriesPrice | — | `ws_test_series_prices` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/testSeries/TestSeriesPrice.model.ts |
| 152 | TestSeriesSubscription | — | `ws_test_series_subscriptions` | — (new feature / Mongo-only) | 🆕 Mongo-only | See src/models/testSeries/TestSeriesSubscription.model.ts |

---

## Column-level detail (migrated modules)

### AppUpdate (`ws_app_update`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | — | `id` → `id` | PK/FK per dump |
| 2 | `latestVersion`  | latestVersion | `latestVersion` → `latestVersion` | PK/FK per dump |
| 3 | `updateType`  | updateType | `updateType` → `updateType` | PK/FK per dump |
| 4 | `isUpdateAvailble`  | — | `isUpdateAvailble` → `isUpdateAvailble` | PK/FK per dump |

**Naming:** Mongo `ws_app_updates` → migration target `ws_app_update`.

### Version (`ws_versions`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | — | `id` → `id` | PK/FK per dump |
| 2 | `latestVersionCode`  | latestVersionCode | `latestVersionCode` → `latestVersionCode` | PK/FK per dump |
| 3 | `lastSupportedVersionCode`  | lastSupportedVersionCode | `lastSupportedVersionCode` → `lastSupportedVersionCode` | PK/FK per dump |

### FAQ (`ws_faq`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | typeId | `id` → `id` | PK/FK per dump |
| 2 | `type`  | typeId | `type` → `type` | PK/FK per dump |
| 3 | `question`  | question | `question` → `question` | PK/FK per dump |
| 4 | `answer`  | answer | `answer` → `answer` | PK/FK per dump |
| 5 | `is_expand`  | — | `is_expand` → `is_expand` | PK/FK per dump |
| 6 | `created_at`  | — | `created_at` → `created_at` | PK/FK per dump |
| 7 | `updated_at`  | — | `updated_at` → `updated_at` | PK/FK per dump |
| 8 | — | `typeId` (ObjectId) | — | Mongo only; MySQL uses enum `type` |
| 9 | — | `ws_faq_types` collection | — | Mongo only; no legacy table |

**Naming:** Mongo `ws_faqs` → migration target `ws_faq`.

### BannerSlider (`ws_banner_slider`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | keyId | `id` → `id` | PK/FK per dump |
| 2 | `image`  | image | `image` → `image` | PK/FK per dump |
| 3 | `key`  | key | `key` → `key` | PK/FK per dump |
| 4 | `keyId` (prisma only) | keyId | `keyId` → `keyId` | PK/FK per dump |
| 5 | `orderBy` (prisma only) | orderBy | `orderBy` → `orderBy` | PK/FK per dump |
| 6 | `created_at`  | — | `created_at` → `created_at` | PK/FK per dump |
| 7 | `updated_at`  | — | `updated_at` → `updated_at` | PK/FK per dump |

**Naming:** Mongo `ws_banner_sliders` → migration target `ws_banner_slider`.

### Testimonial (`ws_testimonial`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | — | `id` → `id` | PK/FK per dump |
| 2 | `name`  | name | `name` → `name` | PK/FK per dump |
| 3 | `title`  | title | `title` → `title` | PK/FK per dump |
| 4 | `discription`  | — | `discription` → `discription` | PK/FK per dump |
| 5 | `rating`  | rating | `rating` → `rating` | PK/FK per dump |

**Naming:** Mongo `ws_testimonials` → migration target `ws_testimonial`.

### Department (`ws_department`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | — | `id` → `id` | PK/FK per dump |
| 2 | `name`  | — | `name` → `name` | PK/FK per dump |
| 3 | `decscription`  | — | `decscription` → `decscription` | PK/FK per dump |
| 4 | `order`  | order | `order` → `order` | PK/FK per dump |
| 5 | `active`  | active | `active` → `active` | PK/FK per dump |
| 6 | `contacts` (prisma only) | — | `contacts` → `contacts` | PK/FK per dump |

**Naming:** Mongo `ws_departments` → migration target `ws_department`.

### TermsAndConditions (`ws_termsandcondition`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | — | `id` → `id` | PK/FK per dump |
| 2 | `module`  | module | `module` → `module` | PK/FK per dump |
| 3 | `terms`  | terms | `terms` → `terms` | PK/FK per dump |
| 4 | `freeShippingMinimumOrderAmount`  | freeShippingMinimumOrderAmount | `freeShippingMinimumOrderAmount` → `freeShippingMinimumOrderAmount` | PK/FK per dump |
| 5 | `status`  | status | `status` → `status` | PK/FK per dump |

**Naming:** Mongo `ws_terms_and_conditions` → migration target `ws_termsandcondition`.

### PopupNotifications (`ws_popup_notification`) — ✅ Migrated

| # | Legacy MySQL column | MongoDB field | Post-migration (Prisma) | Constraints / notes |
|---:|---|---|---|---|
| 1 | `id`  | — | `id` → `id` | PK/FK per dump |
| 2 | `title`  | title | `title` → `title` | PK/FK per dump |
| 3 | `description`  | description | `description` → `description` | PK/FK per dump |
| 4 | `image`  | image | `image` → `image` | PK/FK per dump |
| 5 | `discount`  | discount | `discount` → `discount` | PK/FK per dump |
| 6 | `promocode`  | promocode | `promocode` → `promocode` | PK/FK per dump |
| 7 | `promo_expire_at`  | promocode | `promo_expire_at` → `promo_expire_at` | PK/FK per dump |
| 8 | `status`  | status | `status` → `status` | PK/FK per dump |
| 9 | `created_at`  | — | `created_at` → `created_at` | PK/FK per dump |
| 10 | `updated_at`  | — | `updated_at` → `updated_at` | PK/FK per dump |

**Naming:** Mongo `ws_popup_notifications` → migration target `ws_popup_notification`.


---

## Laravel / infra tables (usually not ported to new API)

These exist in the staging dump but are not Mongoose models in `new-web-sankul`:

| # | Table | Purpose |
|---:|---|---|
| 1 | `ws_migrations` | Laravel migrations history |
| 2 | `ws_failed_jobs` | Laravel queue |
| 3 | `ws_password_resets` | Laravel auth |
| 4 | `ws_personal_access_tokens` | Laravel Sanctum |
| 5 | `ws_permissions`, `ws_roles`, `ws_role_has_permissions`, `ws_model_has_*` | Spatie permissions (Laravel admin) |
| 6 | `ws_users` | Laravel admin users (legacy); new app uses `ws_users` Mongo collection for AdminUser |

New app permission system uses Mongo collections `ws_permissions`, `ws_roles`, etc. — **separate design** from Laravel Spatie tables.

---

## Mongo-only collections (no matching legacy `ws_*` table in dump)

High-priority examples to plan before full migration:

| # | Mongo collection | Feature area |
|---:|---|---|
| 1 | `ws_live_courses`, `ws_live_sessions`, `ws_live_chat_*` | Live classes |
| 2 | `ws_test_series*` | Test series product |
| 3 | `ws_lecture_*`, `ws_folders`, `ws_folder_items` | Student library / notes |
| 4 | `ws_faq_types` | FAQ categories (MySQL uses `type` enum instead) |
| 5 | `ws_social_link*` | Social links CMS |
| 6 | `ws_notifications` (image/popup differ) | Push / in-app notifications |
| 7 | `ws_ebook_downloads`, `ws_wishlists` | Client features |
| 8 | `ws_exam_countdown*` | Exam countdown widgets |
| 9 | `ws_book_settings`, `ws_counters` | Book commerce helpers |

---

## Appendix A — Customer (`ws_customer` / `ws_customers`) ⏳ planned

| # | Legacy MySQL (`ws_customer`) | Type / constraints | MongoDB (`ws_customers`) | Post-migration (`ws_customer` via Prisma) |
|---:|---|---|---|---|
| 1 | `id` | INT PK AI | `_id` ObjectId | `id` Int PK |
| 2 | `full_name` | varchar(255) NULL | `firstName`, `middleName`, `lastName` | `full_name` ← API may split/join names |
| 3 | `phone` | varchar(100) NOT NULL | `phoneNumber` unique | `phone` @map |
| 4 | `email_address` | varchar(255) | `emailAddress` | `email_address` |
| 5 | `referral_code` | varchar(15) | `referralCode` | `referral_code` |
| 6 | `reward_points` | int default 0 | `rewardPoints` | `reward_points` |
| 7 | `password` | varchar(255) | `password` | `password` |
| 8 | `is_phone_verified` | tinyint | `isPhoneVerified` | `is_phone_verified` |
| 9 | `otp`, `otp_expires_at`, `tried_otp`, `otp_blocked_at` | OTP fields | same camelCase | same @map |
| 10 | `profile_picture` | varchar(255) | `profilePicture` | `profile_picture` |
| 11 | `phone_2` | varchar(15) | `phone2` | `phone_2` |
| 12 | `dob` | date | `dob` | `dob` |
| 13 | `education_id` | int FK-ish | `educationId` ObjectId | `education_id` Int |
| 14 | `state`, `district` | int | `stateId`, `districtId` ObjectId | `state`, `district` Int FK |
| 15 | `city`, `gender`, `language` | varchar | same | same |
| 16 | `goal` | **JSON** array of goal ids | `goals` ObjectId[] | `goal` Json |
| 17 | `facebook_id` | varchar (legacy) | — | — (drop or nullable migration) |
| 18 | `verified` | tinyint | `verified` | `verified` |
| 19 | `device` | text (FCM) | `firebaseTokens[]` embedded | `device` text (single token legacy) |
| 20 | `os_type` | enum android/ios | `osType` | `os_type` |
| 21 | `last_login_*`, `login_count`, `is_login` | login meta | same | same @map |
| 22 | `is_account_deleted`, `status` | flags | same | same |
| 23 | `created_at`, `updated_at` | timestamps | camelCase | snake_case @map |
| 24 | — | — | `isProfileCompleted` | — (Mongo-only flag; derive on migrate) |

**Migration risk:** High — auth, tokens, and profile APIs depend on this. Transformer must preserve mobile/admin JSON contracts.

---

## Appendix B — Book (`ws_book` / `ws_books`) ⏳ planned

| # | Legacy MySQL (`ws_book`) | MongoDB (`ws_books`) | Post-migration Prisma | Notes |
|---:|---|---|---|---|
| 1 | `id` int PK | `_id` ObjectId | `id` Int |  |
| 2 | `name` | `name` | `name` |  |
| 3 | `thumbnail`, `author`, `image`, `description` | same | same |  |
| 4 | `demo_url` | `demoUrl` | `demo_url` |  |
| 5 | — | `bookUrl` | — | Mongo-only field |
| 6 | — | `examCountdownCategoryId` | — | Mongo-only ObjectId |
| 7 | `weight`, `pages`, `dynamic_link` | same | same |  |
| 8 | `list_price`, `discounted_price`, `shipping_price` | camelCase | snake_case |  |
| 9 | `order_by` | `orderBy` | `order_by` |  |
| 10 | `language` | `language` | `language` |  |
| 11 | `is_magazine`, `is_combo` | same | `is_magazine`, `is_combo` |  |
| 12 | `status` | `status` | `active` @map `status` | Prisma field rename |
| 13 | — | `publication`, `deliveryEta`, `isTrending` | — | Mongo commerce extras |
| 14 | `created_at`, `updated_at` | timestamps | same |  |

**Related legacy tables (Prisma, no Mongoose model):** `ws_book_cart`, `ws_book_cart_item`, `ws_book_order`, `ws_book_order_item`, `ws_book_tracking`.  
**Mongo extras:** `ws_book_orders`, `ws_book_carts`, `ws_book_settings`, `ws_counters`.

---

## Maintenance

1. After adding a Prisma module migration, update `MIGRATION_MYSQL_MODULES` and re-run `yarn docs:schema-comparison` and `yarn docs:field-comparison`.
2. Edit **Appendix A/B** in `scripts/generate-schema-comparison.ts` if column mappings change; re-run `yarn docs:schema-comparison`.
3. Add a manual subsection under **Column-level detail** if the generator’s auto-mapping is insufficient (complex renames).
4. Link from [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md), [MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md), and [testing-guide.md](./testing-guide.md).

