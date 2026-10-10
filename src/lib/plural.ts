/** Czech plural: 1 → one, 2-4 → few, otherwise many (including 0 and 22). */
export function pluralCs(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

export const credits = (n: number) => `${n} ${pluralCs(n, "kredit", "kredity", "kreditů")}`;
