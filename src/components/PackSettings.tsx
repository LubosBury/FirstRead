import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { api, ApiError, type AdminCreditPack } from "@/lib/api";
import { czkPerCredit } from "@/lib/price";

const same = (a: AdminCreditPack, b: AdminCreditPack) =>
  a.credits === b.credits && a.priceCzk === b.priceCzk && a.label === b.label && a.active === b.active;

/** Admin editing of the three credit packs on sale. Packs are edited, never added or removed. */
export function PackSettings() {
  const [saved, setSaved] = useState<AdminCreditPack[] | null>(null);
  const [packs, setPacks] = useState<AdminCreditPack[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.adminPacks().then(
      (list) => {
        setSaved(list);
        setPacks(list);
      },
      () => setMessage("Balíčky se nepodařilo načíst. Načtěte prosím stránku znovu."),
    );
  }, []);

  const edit = (id: string, change: Partial<AdminCreditPack>) =>
    setPacks((list) => list.map((p) => (p.id === id ? { ...p, ...change } : p)));

  const changed = packs.filter((p, i) => saved && !same(p, saved[i]));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      for (const pack of changed) await api.saveAdminPack({ ...pack, label: pack.label?.trim() || null });
      setMessage("Uloženo. Nové ceny platí pro další nákupy.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Uložení se nepovedlo. Zkuste to prosím znovu.");
    } finally {
      // Re-read, so a half-finished save shows what the server really holds.
      await api.adminPacks().then(
        (list) => {
          setSaved(list);
          setPacks(list);
        },
        () => {},
      );
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-extrabold">Balíčky kreditů</h2>
      <p className="mb-3 text-xs text-muted">Co si učitelé mohou koupit na stránce Kredity.</p>
      {saved === null ? (
        message ? (
          <p className="text-sm text-muted">{message}</p>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
        )
      ) : (
        <form onSubmit={save} className="space-y-4">
          {packs.map((p, i) => (
            <div key={p.id} role="group" aria-label={`Balíček ${i + 1}`} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0">
              <h3 className="text-sm font-extrabold">Balíček {i + 1}</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor={`p-credits-${p.id}`}>Kreditů</Label>
                  <Stepper id={`p-credits-${p.id}`} value={p.credits} min={1} max={1000} onChange={(credits) => edit(p.id, { credits })} />
                </div>
                <div>
                  <Label htmlFor={`p-price-${p.id}`}>Cena v Kč</Label>
                  <Stepper id={`p-price-${p.id}`} value={p.priceCzk} min={1} max={100000} onChange={(priceCzk) => edit(p.id, { priceCzk })} />
                </div>
              </div>
              <p className="text-xs text-muted">{czkPerCredit(p.priceCzk, p.credits)} za kredit</p>
              <div>
                <Label htmlFor={`p-label-${p.id}`}>Štítek (nepovinný)</Label>
                <Input
                  id={`p-label-${p.id}`}
                  maxLength={30}
                  placeholder="např. Nejoblíbenější"
                  value={p.label ?? ""}
                  onChange={(e) => edit(p.id, { label: e.target.value || null })}
                />
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-brand"
                  checked={p.active}
                  onChange={(e) => edit(p.id, { active: e.target.checked })}
                />
                Nabízet k prodeji
              </label>
            </div>
          ))}
          <Button type="submit" className="w-full" disabled={saving || changed.length === 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Uložit balíčky
          </Button>
          {message && <p className="text-sm text-muted">{message}</p>}
        </form>
      )}
    </Card>
  );
}
