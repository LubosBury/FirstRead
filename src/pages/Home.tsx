import { FilePlus2, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { api, type SheetSummary } from "@/lib/api";
import { TEMPLATES } from "@/templates/registry";

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

export function Home() {
  const [sheets, setSheets] = useState<SheetSummary[] | null>(null);

  useEffect(() => {
    api.sheets().then(setSheets, () => setSheets([]));
  }, []);

  async function remove(s: SheetSummary) {
    if (!confirm(`Smazat list „${s.title}“?`)) return;
    await api.deleteSheet(s.id);
    setSheets((list) => list?.filter((x) => x.id !== s.id) ?? null);
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-3 text-2xl font-extrabold">Nový list</h1>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <Link key={t.id} to={`/sheets/new/${t.id}`}>
              <Card className="h-full transition hover:border-brand hover:shadow-md">
                <FilePlus2 className="mb-2 h-7 w-7 text-brand" />
                <h2 className="font-extrabold">{t.name}</h2>
                <p className="text-sm text-muted">{t.description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-extrabold">Uložené listy</h2>
        {sheets === null ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        ) : sheets.length === 0 ? (
          <p className="text-muted">Zatím žádné. Začněte novým listem nahoře.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {sheets.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/sheets/${s.id}`} className="flex-1 font-semibold hover:text-brand">
                  {s.title}
                </Link>
                <span className="text-sm text-muted">{dateFmt.format(new Date(s.updatedAt))}</span>
                <button type="button" aria-label="Smazat list" onClick={() => remove(s)} className="text-muted hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
