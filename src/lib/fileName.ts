/** ASCII-only, so the name survives every OS, browser locale and mail client. */
export function fileSafeName(title: string, ext: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "list"}.${ext}`;
}
