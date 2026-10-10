import { czechMonthName } from "@/lib/months";
import type { TemplateDefinition } from "@/templates/types";
import { ReadingChallengeEditor } from "./Editor";
import { layoutReadingChallenge } from "./layout";
import { defaultReadingChallengeParams, readingChallengeSchema, type ReadingChallengeParams } from "./params";

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase("cs-CZ") + s.slice(1);

export const readingChallenge: TemplateDefinition<ReadingChallengeParams> = {
  id: "reading-challenge",
  name: "Čtenářská výzva",
  description: "Nadpis, hlavní obrázek dole a jeden obrázek k vybarvení za každý den v měsíci.",
  paramsSchema: readingChallengeSchema,
  defaultParams: defaultReadingChallengeParams,
  sheetTitle: (p) => `${capitalize(czechMonthName(p.month))} ${p.year} - Čtenářská výzva`,
  imageIds: (p) => [p.mainImage.imageId, ...p.icons].filter((id): id is string => !!id),
  layout: layoutReadingChallenge,
  Editor: ReadingChallengeEditor,
};
