// Live courses: admin management plus client listings, recordings, preview and live chat logic.
// Facade: the implementation is split by concern into ./live-course.*.service.ts; this
// file only re-exports them so existing imports keep working. Import new code from the
// concern file directly.
export { parseLiveId } from "./live-course.shared";
export * from "./live-course.crud.service";
export * from "./live-course.subscription.service";
export * from "./live-course.schedule.service";
export * from "./live-course.chat.service";
export * from "./live-course.client.service";
export * from "./live-course.recording.service";
export * from "./live-course.preview.service";
export * from "./live-course.feed.service";
export * from "./live-course.vod.service";
