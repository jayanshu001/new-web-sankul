// Shared helpers for the year → month → week drill-down used by the daily
// quizzes and free-tests endpoints. Semantics match client/quizzes/daily:
// Week 1 = days 1–7, Week 2 = 8–14, Week 3 = 15–21, Week 4 = 22–28,
// Week 5 = 29–end-of-month.

export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Map a day-of-month (1–31) to its week bucket (1–5).
export const weekOfMonth = (day: number): number =>
  day <= 28 ? Math.ceil(day / 7) : 5;

// Inclusive [start, end] date range for a given week of a month.
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
