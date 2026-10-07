// Slugs: kebab-case; uniqueness appends `-2`, `-3`, ... until `existsFn` reports
// no collision (same algorithm as the Laravel jobs admin).

export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);

export const uniqueSlug = async (
  base: string,
  existsFn: (candidate: string) => Promise<boolean>
): Promise<string> => {
  const root = slugify(base) || "item";
  let candidate = root;
  let attempt = 1;
  while (await existsFn(candidate)) {
    attempt += 1;
    candidate = `${root}-${attempt}`;
  }
  return candidate;
};
