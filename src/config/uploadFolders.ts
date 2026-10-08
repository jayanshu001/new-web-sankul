// src/config/uploadFolders.ts
//
// SINGLE source of truth for where every upload lands in the Spaces bucket.
// Change a folder here and every route that uses it follows — routes never
// hard-code a path, they pick a key: `uploadTo(UPLOAD_FOLDERS.package)` (or a
// field→folder map for multi-file forms) right before the multer middleware.
//
// Why these exact paths: they mirror the old Laravel admin
// (websankul-mobile-app-admin-panel, `Storage::disk('spaces')->put('uploads/…')`).
// The old mobile app prepends its own `<cdn>/uploads/<folder>/` base to a bare
// filename, and the old API (websankul-api `api_response.js` KNOWN_UPLOAD_PATHS)
// strips our full URLs back down to that filename. So a file MUST sit directly
// inside its legacy folder (no extra sub-folders) or the old app 404s.
// Do not rename a LEGACY entry unless the old app/API change with it.
//
// No trailing slash — the uploader appends `/<timestamp>-<random>.<ext>`.

export const UPLOAD_FOLDERS = {
  // ── Legacy folders (match Laravel admin 1:1) ─────────────────────────────
  package: "uploads/package", // courses + packages (Courses/Packages/EducatorCourses.php)
  educator: "uploads/educator", // educators (Educators.php)
  qcategory: "uploads/qcategory", // subject / video / material categories
  quizCategory: "uploads/quiz_category", // exam categories (Quizscategorys.php)
  quizSolution: "uploads/quizs", // exam solution PDF (Quizs.php)
  questions: "uploads/questions", // question / solution / option images
  materials: "uploads/materials", // material files (Materials.php)
  bookImages: "uploads/book_images", // book image (Books.php)
  bookThumbnail: "uploads/books/thumbnail", // book thumbnail
  bookDemo: "uploads/books/demo_copy", // book demo PDF
  ebookImages: "uploads/e-books/images", // ebook image (Ebooks.php)
  ebookThumbnail: "uploads/e-books/thumbnail",
  ebookDemo: "uploads/e-books/demo_book",
  ebookFull: "uploads/e-books/full_book",
  popup: "uploads/popup_notification", // popups (PopupNotifications.php)
  banner: "uploads/banner_images", // banners + live banners (BannerSliders.php)
  customers: "uploads/customers", // customer profile picture (Customers.php)
  users: "uploads/users", // admin users (UserController.php)
  promoters: "uploads/promoters", // promoters (Promoters.php)
  offlineCenters: "uploads/websankul_static/offline_centers",
  offlineBatches: "uploads/websankul_static/offline_batches",
  jobsOrganizations: "uploads/govt-jobs/organizations", // GovtJobFileService.php
  jobsOgImages: "uploads/govt-jobs/og-images", // featured + OG images
  jobsEditor: "uploads/govt-jobs/editor", // inline editor images
  jobsContentFiles: "uploads/govt-jobs/content-files", // editor document attachments
  jobsPapers: "uploads/govt-jobs/papers",
  jobsPaperPreviews: "uploads/govt-jobs/paper-previews",

  // ── New-admin-only resources (no Laravel equivalent) ─────────────────────
  liveCourse: "uploads/live_course",
  testSeries: "uploads/test_series", // thumbnails + content-category icons
  pcMaterial: "uploads/pc_material", // master › materials
  packageCategory: "uploads/package_category",
  goals: "uploads/goals",
  notifications: "uploads/notifications", // broadcast + image notifications
  socialLinks: "uploads/social_links",
  currentAffairs: "uploads/current_affairs",
  cities: "uploads/cities", // address › cities
  offlineCities: "uploads/websankul_static/offline_cities",
  offlineBanners: "uploads/websankul_static/offline_banners",
  audioNotes: "uploads/customer/audio-notes", // + /<customerId>
  rankSheets: "uploads/rank-sheets", // + /<exam>/<shift>/<category>/<gender>/ — read response sheets, private

  // Fallback when a route forgot `uploadTo(...)` — keeps the old behaviour.
  default: "admin/profiles",
} as const;

export type UploadFolder = (typeof UPLOAD_FOLDERS)[keyof typeof UPLOAD_FOLDERS];
