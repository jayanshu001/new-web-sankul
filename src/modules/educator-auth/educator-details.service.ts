import { educatorDetailsRepository as repo } from "./educator-details.repository";
import {
  toCourseDto,
  toLiveCourseDto,
  toPackageDto,
  toVideoCategoryDto,
  toLiveSessionDto,
} from "./educator-details.transformer";

const uniqIds = (xs: (number | null | undefined)[]): number[] =>
  [...new Set(xs.filter((x): x is number => x != null && x > 0))];

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Builds the admin educator-details aggregate (associations + summary) from MySQL,
 * matching the legacy Mongo handler's response shape exactly. Video categories are
 * split into recording "folders" (those linked to a live course) vs root video
 * categories, mirroring the Mongo liveCourseId split.
 */
export const getEducatorAssociations = async (educatorId: number) => {
  const [courses, liveCourses, packages, videoCats, liveSessions] = await Promise.all([
    repo.coursesByEducator(educatorId),
    repo.liveCoursesByEducator(educatorId),
    repo.packagesByEducator(educatorId),
    repo.videoCategoriesByEducator(educatorId),
    repo.liveSessionsByEducator(educatorId),
  ]);

  const [courseCountRows, packageCountRows, liveCountRows, folderLiveCourses] = await Promise.all([
    repo.courseSubCounts(courses.map((c) => c.id)),
    repo.packageSubCounts(packages.map((p) => p.id)),
    repo.liveCourseSubCounts(liveCourses.map((lc) => lc.id)),
    repo.liveCoursesByIds(uniqIds(videoCats.map((v) => v.liveCourseId))),
  ]);

  const courseCounts = new Map(courseCountRows.map((r) => [r.courseId as number, r._count._all]));
  const packageCounts = new Map(packageCountRows.map((r) => [r.packageId as number, r._count._all]));
  const liveCounts = new Map(liveCountRows.map((r) => [r.liveCourseId as number, r._count._all]));
  const liveCourseNames = new Map(folderLiveCourses.map((lc) => [lc.id, { name: lc.name }]));

  const courseDtos = courses.map((c) => toCourseDto(c, courseCounts));
  const liveCourseDtos = liveCourses.map((lc) => toLiveCourseDto(lc, liveCounts));
  const packageDtos = packages.map((p) => toPackageDto(p, packageCounts));
  const vcatDtos = videoCats.map((v) => toVideoCategoryDto(v, liveCourseNames));
  const liveSessionDtos = liveSessions.map(toLiveSessionDto);

  // Split: live-course folders (linked to a live course) vs root video categories.
  const liveCourseFolders = vcatDtos.filter((v) => v.liveCourseId);
  const videoCategories = vcatDtos.filter((v) => !v.liveCourseId);

  const associations = {
    courses: courseDtos,
    liveCourses: liveCourseDtos,
    liveCourseFolders,
    liveSessions: liveSessionDtos,
    videoCategories,
    packages: packageDtos,
  };

  const summary = {
    totals: {
      courses: courseDtos.length,
      liveCourses: liveCourseDtos.length,
      liveCourseFolders: liveCourseFolders.length,
      liveSessions: liveSessionDtos.length,
      videoCategories: videoCategories.length,
      packages: packageDtos.length,
    },
    active: {
      courses: courseDtos.filter((c) => c.status).length,
      liveCourses: liveCourseDtos.filter((c) => c.status).length,
      packages: packageDtos.filter((p) => p.status).length,
    },
    totalSubscribers:
      sum(courseDtos.map((c) => c.subscribersCount)) +
      sum(liveCourseDtos.map((c) => c.subscribersCount)) +
      sum(packageDtos.map((p) => p.subscribersCount)),
    totalSessionsConducted: liveSessionDtos.filter((s) => s.status === "ENDED").length,
  };

  return { associations, summary };
};
