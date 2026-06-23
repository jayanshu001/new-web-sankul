/**
 * Maps ws_* association rows into the exact DTO shape the legacy Mongo educator
 * -details handler returned, so the admin UI is identical on either backend.
 * `purchase`/`is_featured` are CourseFlag01 enums ("yes" = '1') → booleans.
 */

type CountMap = Map<number, number>;
type NameMap = Map<number, { name: string | null }>;

const flag = (v: string | null | undefined) => v === "yes";

type CourseRow = {
  id: number; name: string | null; image: string | null; level: string | null;
  status: boolean; ordered: number; createdAt: Date | null;
  purchase: string | null; is_featured: string | null;
};

export const toCourseDto = (c: CourseRow, counts: CountMap) => ({
  _id: String(c.id),
  name: c.name,
  image: c.image,
  level: c.level,
  isPaid: flag(c.purchase),
  isPopular: flag(c.is_featured),
  status: c.status,
  ordered: c.ordered,
  subscribersCount: counts.get(c.id) ?? 0,
  createdAt: c.createdAt,
});

type LiveCourseRow = {
  id: number; name: string; image: string | null; level: string | null;
  classType: string; status: boolean; ordered: number; createdAt: Date | null;
};

export const toLiveCourseDto = (lc: LiveCourseRow, counts: CountMap) => ({
  _id: String(lc.id),
  name: lc.name,
  image: lc.image,
  level: lc.level,
  classType: lc.classType,
  status: lc.status,
  ordered: lc.ordered,
  subscribersCount: counts.get(lc.id) ?? 0,
  createdAt: lc.createdAt,
});

type PackageRow = {
  id: number; name: string; image: string; active: boolean;
  order_by: number; created_at: Date | null;
};

export const toPackageDto = (p: PackageRow, counts: CountMap) => ({
  _id: String(p.id),
  name: p.name,
  image: p.image,
  status: p.active,
  active: p.active,
  order: p.order_by,
  subscribersCount: counts.get(p.id) ?? 0,
  createdAt: p.created_at,
});

type VideoCategoryRow = {
  id: number; title: string; slug: string; image: string; status: boolean;
  order_by: number; liveCourseId: number | null; created_at: Date | null;
};

export const toVideoCategoryDto = (v: VideoCategoryRow, liveCourseNames: NameMap) => {
  const lc = v.liveCourseId != null ? liveCourseNames.get(v.liveCourseId) : undefined;
  return {
    _id: String(v.id),
    title: v.title,
    slug: v.slug,
    image: v.image,
    status: v.status,
    order_by: v.order_by,
    courseId: null,
    liveCourseId: v.liveCourseId != null && lc ? { _id: String(v.liveCourseId), name: lc.name } : null,
    createdAt: v.created_at,
  };
};

type LiveSessionRow = {
  id: number; title: string | null; subject: string | null; status: string;
  scheduledAt: Date | null; endAt: Date | null; createdAt: Date | null;
};

export const toLiveSessionDto = (s: LiveSessionRow) => ({
  _id: String(s.id),
  title: s.title,
  subject: s.subject,
  status: s.status,
  scheduledAt: s.scheduledAt,
  endAt: s.endAt,
  liveCourseId: null,
  createdAt: s.createdAt,
});
