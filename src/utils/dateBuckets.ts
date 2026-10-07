// Date buckets: year → month → week drill-down for daily quizzes and free tests:
// weeks 1-4 are days 1-7, 8-14, 15-21, 22-28; week 5 is 29 to month end.

export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const weekOfMonth = (day: number): number =>
  day <= 28 ? Math.ceil(day / 7) : 5;

// Inclusive range.
export const weekRange = (
  year: number,
  month: number,
  week: number
): { start: Date; end: Date } => {
  const startDay = (week - 1) * 7 + 1;
  const start = new Date(year, month - 1, startDay, 0, 0, 0, 0);
  const end =
    week === 5
      ? new Date(year, month, 0, 23, 59, 59, 999) // last day of month
      : new Date(year, month - 1, startDay + 6, 23, 59, 59, 999);
  return { start, end };
};
