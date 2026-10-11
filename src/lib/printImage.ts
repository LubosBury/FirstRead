const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A page that scales one image to fill A4 and prints itself once it has loaded. */
export function buildPrintHtml(src: string, title: string): string {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  html, body { margin: 0; height: 100%; background: #fff; }
  body { display: flex; align-items: center; justify-content: center; }
  img { width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
<img src="${esc(src)}" alt="">
<script>
  const img = document.querySelector("img");
  const go = () => { window.onafterprint = () => window.close(); window.print(); };
  img.complete ? go() : img.addEventListener("load", go);
</script>
</body>
</html>`;
}

/**
 * Prints one image on its own A4 page. Must run inside a click handler, or the
 * browser blocks the window. Blob URLs work because the new window shares the
 * opener's origin.
 */
export function printImage(src: string, title: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(buildPrintHtml(src, title));
  win.document.close();
  return true;
}
