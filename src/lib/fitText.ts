/** Width of `text` at font size `size`, in the same units as the size. */
export type Measure = (text: string, size: number) => number;

/** Largest size up to `max` at which `text` fits in `width`. */
export function fitFontSize(text: string, max: number, width: number, measure: Measure): number {
  const w = measure(text, max);
  return w <= width ? max : (max * width) / w;
}

let ctx: CanvasRenderingContext2D | null | undefined;

/** Measures with the real font through a shared offscreen canvas. */
export function canvasMeasure(family: string, weight: number): Measure {
  if (ctx === undefined) {
    try {
      ctx = document.createElement("canvas").getContext("2d");
    } catch {
      ctx = null;
    }
  }
  const c = ctx;
  if (!c) return (text, size) => text.length * size * 0.55;
  return (text, size) => {
    // Measure at a fixed pixel size and scale: canvas rounds tiny fonts.
    c.font = `${weight} 100px "${family}"`;
    return (c.measureText(text).width / 100) * size;
  };
}
