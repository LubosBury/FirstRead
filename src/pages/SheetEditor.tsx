import { Check, Download, Eye, Loader2, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAssets } from "@/lib/assets";
import { fileSafeName } from "@/lib/fileName";
import { SheetSvg } from "@/lib/renderSvg";
import { cn } from "@/lib/utils";
import { getTemplate } from "@/templates/registry";
import type { AssetSizes, TemplateDefinition } from "@/templates/types";

type Loaded = { template: TemplateDefinition<Record<string, unknown>>; params: Record<string, unknown>; id: string | null };
/** Phones show either the form or the preview; wider screens show both. */
type View = "edit" | "preview";

export function SheetEditor() {
  const { id, templateId } = useParams();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lives here, not in Workspace, so the first save (which remounts it) keeps the view.
  const [view, setView] = useState<View>("edit");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (id) {
          const sheet = await api.sheet<Record<string, unknown>>(id);
          const template = getTemplate(sheet.templateId);
          if (!template) throw new Error("Neznámá šablona.");
          // Older saves may lack newer params; defaults fill the gaps.
          const params = template.paramsSchema.parse({ ...template.defaultParams(), ...sheet.params });
          if (alive) setState({ template, params, id });
        } else {
          const template = getTemplate(templateId ?? "");
          if (!template) throw new Error("Neznámá šablona.");
          if (alive) setState({ template, params: template.defaultParams(), id: null });
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "List se nepodařilo načíst.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, templateId]);

  if (error) return <p className="rounded-lg bg-danger/10 px-4 py-3 text-danger">{error}</p>;
  if (!state) return <Loader2 className="mx-auto mt-16 h-7 w-7 animate-spin text-brand" />;
  return <Workspace key={state.id ?? "new"} initial={state} view={view} onViewChange={setView} />;
}

const VIEWS: { id: View; label: string; icon: typeof Eye }[] = [
  { id: "edit", label: "Upravit", icon: SlidersHorizontal },
  { id: "preview", label: "Náhled", icon: Eye },
];

function Workspace({ initial, view, onViewChange }: { initial: Loaded; view: View; onViewChange: (v: View) => void }) {
  const { template } = initial;
  const navigate = useNavigate();
  const [params, setParams] = useState(initial.params);
  const [sheetId, setSheetId] = useState(initial.id);
  const [dirty, setDirty] = useState(!initial.id);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const lineArt = params.lineArt !== false;
  const assets = useAssets(template.imageIds(params), lineArt);
  const sizes = useMemo<AssetSizes>(
    () => Object.fromEntries(Object.entries(assets).map(([k, a]) => [k, { w: a.w, h: a.h }])),
    [assets],
  );
  const layout = useMemo(() => template.layout(params, sizes), [template, params, sizes]);
  const title = template.sheetTitle(params);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(next: Record<string, unknown>) {
    setParams(next);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      if (sheetId) {
        await api.updateSheet(sheetId, title, params);
      } else {
        const { id } = await api.createSheet(template.id, title, params);
        setSheetId(id);
        navigate(`/sheets/${id}`, { replace: true });
      }
      setDirty(false);
      setNotice("Uloženo.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Uložení se nepovedlo.");
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    setExporting(true);
    try {
      // jsPDF is most of the bundle and only needed here.
      const { exportPdf } = await import("@/lib/exportPdf");
      await exportPdf(layout, assets, fileSafeName(title, "pdf"));
    } finally {
      setExporting(false);
    }
  }

  function switchView(next: View) {
    onViewChange(next);
    window.scrollTo({ top: 0 });
  }

  // Sizes the preview so the whole page fits on screen below the header and
  // title (and, on phones, above the bottom bar), never wider than 620px.
  const fit = { "--page-ratio": layout.page.w / layout.page.h } as CSSProperties;
  const saveIcon = saving ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : dirty ? (
    <Save className="h-4 w-4" />
  ) : (
    <Check className="h-4 w-4" />
  );
  const pdfIcon = exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />;

  const Editor = template.Editor;
  return (
    <div className="grid gap-4 md:grid-cols-[20rem_1fr] md:gap-6 lg:grid-cols-[22rem_1fr]">
      <aside className={cn("order-2 md:order-1", view === "preview" && "hidden md:block")}>
        <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <Editor params={params} onChange={change} />
        </div>
      </aside>
      <section className="order-1 md:order-2">
        <div className="space-y-3 md:sticky md:top-16">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-auto text-xl font-extrabold">{title}</h1>
            {notice && <span className="text-sm text-muted">{notice}</span>}
            <div className="hidden gap-2 md:flex">
              <Button variant="secondary" onClick={save} disabled={saving || !dirty}>
                {saveIcon}
                {dirty ? "Uložit" : "Uloženo"}
              </Button>
              <Button onClick={download} disabled={exporting}>
                {pdfIcon}
                Stáhnout PDF
              </Button>
            </div>
          </div>
          <div
            style={fit}
            className={cn(
              "mx-auto max-w-[min(620px,calc((100dvh-12rem)*var(--page-ratio)))] overflow-hidden rounded-md shadow-lg ring-1 ring-line md:max-w-[min(620px,calc((100dvh-8.5rem)*var(--page-ratio)))]",
              view === "edit" && "hidden md:block",
            )}
          >
            <SheetSvg layout={layout} assets={assets} className="block h-auto w-full" />
          </div>
        </div>
      </section>
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-line bg-surface/95 px-3 pt-2 backdrop-blur md:hidden print:hidden">
        <div role="group" aria-label="Zobrazení" className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => switchView(v.id)}
              className={cn(
                "flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold",
                view === v.id ? "bg-surface text-ink shadow-sm" : "text-muted",
              )}
            >
              <v.icon className="hidden h-4 w-4 min-[360px]:block" />
              {v.label}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={save}
          disabled={saving || !dirty}
          aria-label={dirty ? "Uložit" : "Uloženo"}
          title={dirty ? "Uložit" : "Uloženo"}
          className="h-12 w-12"
        >
          {saveIcon}
        </Button>
        <Button onClick={download} disabled={exporting} aria-label="Stáhnout PDF" className="h-12 px-4">
          {pdfIcon}
          PDF
        </Button>
      </div>
    </div>
  );
}
