import { useEffect, useState } from "react";
import { cleanLineArt } from "./lineArt";

export type Asset = { url: string; w: number; h: number };

/** Big enough for 300 DPI at the main picture's size; keeps uploads of phone photos cheap. */
const MAX_SIDE = 2048;

const cache = new Map<string, Promise<Asset>>();

async function load(id: string, lineArt: boolean): Promise<Asset> {
  const res = await fetch(`/api/images/${id}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`image ${id}: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  if (lineArt) {
    const data = ctx.getImageData(0, 0, w, h);
    cleanLineArt(data.data);
    ctx.putImageData(data, 0, 0);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
  return { url: URL.createObjectURL(blob), w, h };
}

/** Loads (and, for line art, cleans) an image once per session. */
export function loadAsset(id: string, lineArt: boolean): Promise<Asset> {
  const key = `${id}:${lineArt ? 1 : 0}`;
  let p = cache.get(key);
  if (!p) {
    p = load(id, lineArt);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function useAssets(ids: string[], lineArt: boolean): Record<string, Asset> {
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const key = ids.join(",");

  useEffect(() => {
    let alive = true;
    const wanted = key ? key.split(",") : [];
    Promise.allSettled(wanted.map((id) => loadAsset(id, lineArt).then((a) => [id, a] as const))).then((results) => {
      if (!alive) return;
      const next: Record<string, Asset> = {};
      for (const r of results) if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
      setAssets(next);
    });
    return () => {
      alive = false;
    };
  }, [key, lineArt]);

  return assets;
}
