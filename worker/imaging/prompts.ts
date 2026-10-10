const STYLE =
  "Black-and-white coloring page for 6-year-old children. Thick, clean, continuous black outlines on a plain white background. " +
  "No shading, no gray, no color fills, no text, no letters, no border, no frame.";

const SLOT = {
  main: "A friendly, simple illustration with large closed areas that are easy to color.",
  icon: "A single simple object, centered, filling most of the square, with large closed areas, recognizable when printed 2 cm wide.",
};

/** Wraps the teacher's words (any language) in the house coloring-page style. */
export function buildPrompt(slot: "main" | "icon", prompt: string, hasReference: boolean): string {
  const subject = prompt.trim();
  if (hasReference) {
    return [
      "Redraw the provided image as a coloring page, keeping its subject and composition.",
      STYLE,
      SLOT[slot],
      subject && `Additional instructions: ${subject}`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return `${STYLE} Subject: ${subject}. ${SLOT[slot]}`;
}
