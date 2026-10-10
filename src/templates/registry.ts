import { readingChallenge } from "./reading-challenge/definition";
import type { TemplateDefinition } from "./types";

// A new worksheet type is a new folder plus one line here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATES: TemplateDefinition<any>[] = [readingChallenge];

export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id);
