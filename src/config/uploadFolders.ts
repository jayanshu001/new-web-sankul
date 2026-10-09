// Upload folders: the Spaces key prefix for every upload kind.
// Where every upload lands in Spaces; routes pick a key via `uploadTo(...)`, never
// a hard-coded path. Legacy entries mirror the old Laravel admin: the old mobile
// app prepends `<cdn>/uploads/<folder>/` to a bare filename (and the old API strips
// our URLs back to it), so files must sit directly in their legacy folder. Do not
// rename a legacy entry unless the old app/API change with it.
// No trailing slash: the uploader appends `/<timestamp>-<random>.<ext>`.

export const UPLOAD_FOLDERS = {
  // Legacy folders (match Laravel admin 1:1)
  package: "uploads/package", // courses + packages
  educator: "uploads/educator",
  qcategory: "uploads/qcategory", // subject / video / material categories
  quizCategory: "uploads/quiz_category", // exam categories
  quizSolution: "uploads/quizs", // exam solution PDF
  questions: "uploads/questions", // question / solution / option images
  materials: "uploads/materials",
  bookImages: "uploads/book_images",
  bookThumbnail: "uploads/books/thumbnail",
  bookDemo: "uploads/books/demo_copy", // book demo PDF
  ebookImages: "uploads/e-books/images",
  ebookThumbnail: "uploads/e-books/thumbnail",
  ebookDemo: "uploads/e-books/demo_book",
  ebookFull: "uploads/e-books/full_book",
  popup: "uploads/popup_notification",
  banner: "uploads/banner_images", // banners + live banners
  customers: "uploads/customers", // customer profile picture
  users: "uploads/users",
  promoters: "uploads/promoters",
  offlineCenters: "uploads/websankul_static/offline_centers",
  offlineBatches: "uploads/websankul_static/offline_batches",
  jobsOrganizations: "uploads/govt-jobs/organizations",
  jobsOgImages: "uploads/govt-jobs/og-images", // featured + OG images
  jobsEditor: "uploads/govt-jobs/editor", // inline editor images
  jobsContentFiles: "uploads/govt-jobs/content-files", // editor document attachments
  jobsPapers: "uploads/govt-jobs/papers",
  jobsPaperPreviews: "uploads/govt-jobs/paper-previews",

  // New-admin-only resources
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
