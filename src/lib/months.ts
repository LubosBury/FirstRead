import { getDaysInMonth } from "date-fns";

// Nominative. Every Czech month is inanimate masculine or neuter, so the
// accusative after "na" has the same form: "na říjen", "na září".
const CZECH_MONTHS = [
  "leden",
  "únor",
  "březen",
  "duben",
  "květen",
  "červen",
  "červenec",
  "srpen",
  "září",
  "říjen",
  "listopad",
  "prosinec",
] as const;

/** `month` is 1-12. */
export function czechMonthName(month: number): string {
  return CZECH_MONTHS[month - 1];
}

/** `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return getDaysInMonth(new Date(year, month - 1, 1));
}
