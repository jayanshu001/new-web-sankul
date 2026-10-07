// Offline downloads: scope kinds, input and access snapshot types.
/**
 * Video scopes are the containers a lecture can live inside (exactly what
 * `reachableCategoryIds` accepts). `ebook` is the content itself: no membership
 * check and no GET expansion.
 */
export type VideoScopeKind = "course" | "package" | "liveCourse";
export type DownloadScopeKind = VideoScopeKind | "ebook";

export const VIDEO_SCOPE_KINDS: VideoScopeKind[] = ["course", "package", "liveCourse"];
export const DOWNLOAD_SCOPE_KINDS: DownloadScopeKind[] = [...VIDEO_SCOPE_KINDS, "ebook"];

export const isVideoScopeKind = (k: DownloadScopeKind): k is VideoScopeKind => k !== "ebook";

/**
 * `contentId` is the request's `videoId`: a lecture id for video scopes, the ebook
 * id (equal to `scopeId`) for `ebook`. The request field keeps `videoId` for app compatibility.
 */
export interface RegisterDownloadInput {
  customerId: number;
  contentId: number;
  kind: DownloadScopeKind;
  scopeId: number;
}

export interface RegisterDownloadDto {
  videoId: string;
  kind: DownloadScopeKind;
  id: string;
  registeredAt: string;
}

/** One row of GET /client/subscriptions/access. */
export interface SubscriptionAccessItem {
  kind: DownloadScopeKind;
  id: string;
  /** UTC ISO-8601 (`...Z`), or null for a lifetime entitlement that never expires. */
  endAt: string | null;
  /** ceil((endAt - now) / 1 day), floored at 0. null when `endAt` is null. */
  daysLeft: number | null;
  /** Registered content ids this product still covers. Never empty. */
  videoIds: string[];
}

/** Mapped to status codes by the controller, so the service never imports Express. */
export type RegisterFailure =
  | { ok: false; reason: "content_not_found" }
  | { ok: false; reason: "product_not_found" }
  | { ok: false; reason: "not_entitled" }
  | { ok: false; reason: "content_not_in_product" };

export type RegisterResult = { ok: true; dto: RegisterDownloadDto } | RegisterFailure;
