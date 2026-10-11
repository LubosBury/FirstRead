import { z } from "zod";
import { FONT_IDS } from "@/lib/fonts";
import { czechMonthName, daysInMonth } from "@/lib/months";
import { randomSeed } from "@/lib/prng";

export const MAX_ICON_VARIANTS = 4;

export const readingChallengeSchema = z.object({
  title: z.string().max(120),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  count: z.number().int().min(1).max(62),
  font: z.enum(FONT_IDS),
  uppercase: z.boolean(),
  mainImage: z.object({
    imageId: z.string().nullable(),
    position: z.enum(["left", "center", "right"]),
    scale: z.number().min(0.5).max(1.4),
  }),
  icons: z.array(z.string()).max(MAX_ICON_VARIANTS),
  seed: z.number().int(),
  jitter: z.boolean(),
  /** Number the pictures 1..count, one per day, in random order. */
  dayNumbers: z.boolean(),
  /** Clean images to pure black outlines on transparent paper. */
  lineArt: z.boolean(),
});

export type ReadingChallengeParams = z.infer<typeof readingChallengeSchema>;
export type MainPosition = ReadingChallengeParams["mainImage"]["position"];

export const defaultTitle = (month: number) => `Čtenářská výzva na ${czechMonthName(month)}`;

/** Late in a month, a teacher is preparing next month's sheet. */
export function defaultReadingChallengeParams(now: Date = new Date()): ReadingChallengeParams {
  const target = now.getDate() > 20 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : now;
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  return {
    title: defaultTitle(month),
    year,
    month,
    count: daysInMonth(year, month),
    font: "andika",
    uppercase: false,
    mainImage: { imageId: null, position: "right", scale: 1 },
    icons: [],
    seed: randomSeed(),
    jitter: true,
    dayNumbers: false,
    lineArt: true,
  };
}
