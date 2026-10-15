import type { PaperShift, SheetCandidate } from "./rank-predictor.types";

/**
 * Whether a read sheet was sat for the paper it was uploaded to, by what the
 * sheet prints. The question count is checked apart; two papers with the same
 * count are told apart here.
 *
 * Every check refuses only on a clear conflict. A sheet that prints nothing to
 * compare (an OMR sheet has no title, some have no date), or a paper with
 * nothing set to compare against, passes: a real student is never turned away
 * on a guess.
 */

interface PaperFacts {
  name: string;
  code: string;
  /** Stored to the month: the admin form saves "YYYY-MM-01". */
  examDate: Date | null;
  shifts: PaperShift[];
}

export interface PaperMismatch {
  reason: "date" | "title";
  sheet_title: string | null;
  sheet_date: string | null;
}

const ISO_DAY = /^(\d{4})-(\d{2})-\d{2}$/;
const DIGITS = /\d+/g;
const YEAR = /^(19|20)\d{2}$/;

/**
 * An exam is often moved by a few weeks, or runs past the end of its month, and
 * the paper's month is set before the dates are final. A sheet sat within this
 * many months of the paper's month (or of a shift the admin listed) passes.
 */
const MONTH_SLACK = 1;

/** "2026-09-17" -> months since year 0, so months compare across a year end. */
const monthIndex = (isoDay: string): number | null => {
  const match = ISO_DAY.exec(isoDay);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
};

const isoDayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** A sheet sat months away from every date the paper knows is from another sitting. */
const datesConflict = (paper: PaperFacts, testDate: string | null): boolean => {
  const sheetMonth = testDate ? monthIndex(testDate) : null;
  if (sheetMonth === null) return false;
  if (paper.shifts.some((shift) => shift.key.slice(0, 10) === testDate)) return false;

  const anchors = [
    ...(paper.examDate ? [isoDayOf(paper.examDate)] : []),
    ...paper.shifts.map((shift) => shift.key.slice(0, 10)),
  ]
    .map(monthIndex)
    .filter((month): month is number => month !== null);

  return anchors.length > 0 && anchors.every((month) => Math.abs(sheetMonth - month) > MONTH_SLACK);
};

const numbersIn = (text: string): string[] =>
  [...new Set((text.match(DIGITS) ?? []).map((digits) => digits.replace(/^0+(?=\d)/, "")))];

/**
 * The numbers that name a recruitment: its advertisement number ("378") and its
 * year ("2026"). Single digits ("Paper 1", "Class 3") say nothing about which
 * exam it is, so they are left out.
 */
const identifiersOf = (text: string) => {
  const numbers = numbersIn(text);
  return {
    years: numbers.filter((n) => YEAR.test(n)).map(Number),
    others: numbers.filter((n) => !YEAR.test(n) && n.length >= 2),
  };
};

/**
 * The board prints its own long title ("GSSSB CBRT Adv 378 CCE 2026"), never the
 * name the paper is listed under, so the words are not compared — only the
 * numbers, and only when both sides have them. A year a step off still matches,
 * for titles written "2025-26".
 */
const titlesConflict = (paper: PaperFacts, title: string | null): boolean => {
  if (!title) return false;
  const ours = identifiersOf(`${paper.name} ${paper.code}`);
  const theirs = identifiersOf(title);

  const yearsClash =
    ours.years.length > 0 &&
    theirs.years.length > 0 &&
    !theirs.years.some((year) => ours.years.some((own) => Math.abs(year - own) <= 1));
  const numbersClash =
    ours.others.length > 0 &&
    theirs.others.length > 0 &&
    !theirs.others.some((number) => ours.others.includes(number));

  return yearsClash || numbersClash;
};

export const paperMismatchOf = (
  paper: PaperFacts,
  candidate: SheetCandidate | null | undefined
): PaperMismatch | null => {
  const title = candidate?.exam_title?.trim() || null;
  const date = candidate?.test_date ?? null;

  if (datesConflict(paper, date)) return { reason: "date", sheet_title: title, sheet_date: date };
  if (titlesConflict(paper, title)) return { reason: "title", sheet_title: title, sheet_date: date };
  return null;
};
