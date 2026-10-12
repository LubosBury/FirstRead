/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FONT_IDS, FONTS, fontIdSchema } from "./fonts";

const CZECH = "ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž";

const require = createRequire(import.meta.url);

/** Reads a WOFF2 variable-length number; returns [value, next offset]. */
function base128(buf: Buffer, at: number): [number, number] {
  let value = 0;
  for (;;) {
    const byte = buf[at++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [value, at];
  }
}

/** The cmap table of a WOFF2 file. Its tag is index 0 and it is never transformed. */
function cmapTable(file: Buffer): Buffer {
  const numTables = file.readUInt16BE(12);
  let at = 48;
  let offset = 0;
  let cmap: [number, number] | null = null;
  for (let i = 0; i < numTables; i++) {
    const flags = file[at++];
    const tag = flags & 0x3f;
    const version = flags >> 6;
    if (tag === 63) at += 4;
    let length: number;
    [length, at] = base128(file, at);
    // glyf (10) and loca (11) are transformed at version 0, every other table at any other.
    const transformed = tag === 10 || tag === 11 ? version === 0 : version !== 0;
    if (transformed) [length, at] = base128(file, at);
    if (tag === 0) cmap = [offset, length];
    offset += length;
  }
  if (!cmap) throw new Error("no cmap table");
  const tables = brotliDecompressSync(file.subarray(at, at + file.readUInt32BE(20)));
  return tables.subarray(cmap[0], cmap[0] + cmap[1]);
}

/** Every code point the font maps to a real glyph. */
function codePoints(file: Buffer): Set<number> {
  const cmap = cmapTable(file);
  const found = new Set<number>();
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const sub = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(sub);
    if (format === 12) {
      for (let g = 0; g < cmap.readUInt32BE(sub + 12); g++) {
        const group = sub + 16 + g * 12;
        const start = cmap.readUInt32BE(group);
        const glyph = cmap.readUInt32BE(group + 8);
        for (let c = start; c <= cmap.readUInt32BE(group + 4); c++) if (glyph + c - start) found.add(c);
      }
    } else if (format === 4) {
      const segs = cmap.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segs * 2 + 2;
      const deltas = starts + segs * 2;
      const offsets = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const start = cmap.readUInt16BE(starts + s * 2);
        const rangeOffset = cmap.readUInt16BE(offsets + s * 2);
        for (let c = start; c <= cmap.readUInt16BE(ends + s * 2) && c < 0xffff; c++) {
          let glyph = c;
          if (rangeOffset) glyph = cmap.readUInt16BE(offsets + s * 2 + rangeOffset + (c - start) * 2);
          if (!rangeOffset || glyph) glyph = (glyph + cmap.readUInt16BE(deltas + s * 2)) & 0xffff;
          if (glyph) found.add(c);
        }
      }
    }
  }
  return found;
}

function inRange(unicodeRange: string, code: number): boolean {
  return unicodeRange.split(",").some((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, "").split("-");
    return code >= parseInt(from, 16) && code <= parseInt(to, 16);
  });
}

/**
 * Letters the browser would draw in another font: a face only serves a letter
 * when its unicode-range admits it and its file holds a glyph for it.
 */
function missingLetters(cssPath: string, letters: string): string {
  const css = readFileSync(cssPath, "utf8");
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => ({
    range: /unicode-range:\s*([^;]+);/.exec(body)![1],
    file: resolve(dirname(cssPath), /url\(([^)]+\.woff2)\)/.exec(body)![1]),
  }));
  const wanted = [...letters].map((ch) => ch.codePointAt(0)!);
  const covered = new Set<number>();
  for (const face of faces) {
    if (!wanted.some((code) => inRange(face.range, code))) continue;
    const glyphs = codePoints(readFileSync(face.file));
    for (const code of wanted) if (inRange(face.range, code) && glyphs.has(code)) covered.add(code);
  }
  return wanted.filter((code) => !covered.has(code)).map((code) => String.fromCodePoint(code)).join("");
}

describe("sheet fonts", () => {
  it.each(FONT_IDS)("%s draws the whole Czech alphabet", (id) => {
    const css = `@fontsource/${id}/${FONTS[id].weight}.css`;
    expect(readFileSync(resolve(import.meta.dirname, "fonts.ts"), "utf8")).toContain(`import "${css}";`);
    expect(missingLetters(require.resolve(css), CZECH)).toBe("");
  });

  it("notices a letter the font cannot draw", () => {
    expect(missingLetters(require.resolve("@fontsource/andika/700.css"), "Čaあ")).toBe("あ");
  });
});

describe("fontIdSchema", () => {
  it("accepts every font in the picker", () => {
    for (const id of FONT_IDS) expect(fontIdSchema.parse(id)).toBe(id);
  });

  it("opens sheets saved with the retired Fredoka in its replacement", () => {
    expect(fontIdSchema.parse("fredoka")).toBe("nunito");
  });

  it("rejects unknown fonts", () => {
    expect(fontIdSchema.safeParse("comic-sans").success).toBe(false);
  });
});
