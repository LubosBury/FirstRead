import { Download, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAssets } from "@/lib/assets";
import { fileSafeName } from "@/lib/fileName";
import { SheetSvg } from "@/lib/renderSvg";
import { getTemplate } from "@/templates/registry";
import type { AssetSizes, TemplateDefinition } from "@/templates/types";

type Loaded = { template: TemplateDefinition<Record<string, unknown>>; params: Record<string, unknown>; id: string | null };

export function SheetEditor() {
  const { id, templateId } = useParams();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  return <Workspace key={state.id ?? "new"} initial={state} />;
}

function Workspace({ initial }: { initial: Loaded }) {
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

  const Editor = template.Editor;
  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <aside className="order-2 lg:order-1">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <Editor params={params} onChange={change} />
        </div>
      </aside>
      <section className="order-1 lg:order-2">
        <div className="space-y-3 lg:sticky lg:top-16">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-auto text-xl font-extrabold">{title}</h1>
            {notice && <span className="text-sm text-muted">{notice}</span>}
            <Button variant="secondary" onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {dirty ? "Uložit" : "Uloženo"}
            </Button>
            <Button onClick={download} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Stáhnout PDF
            </Button>
          </div>
          <div className="mx-auto max-w-[620px] overflow-hidden rounded-md shadow-lg ring-1 ring-line">
            <SheetSvg layout={layout} assets={assets} className="block h-auto w-full" />
          </div>
        </div>
      </section>
    </div>
  );
}
