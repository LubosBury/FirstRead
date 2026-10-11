import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { api, ApiError, type EngineSettings as Settings } from "@/lib/api";
import { credits } from "@/lib/plural";

/** Admin choice of the engine every generation uses unless overridden. */
export function EngineSettings() {
  const { refresh } = useMe();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.adminSettings().then(setSettings, () => setMessage("Nastavení se nepodařilo načíst."));
  }, []);

  async function change(defaultEngine: string) {
    setSaving(true);
    setMessage(null);
    try {
      setSettings(await api.saveAdminSettings(defaultEngine));
      setMessage("Uloženo. Platí pro všechna další generování.");
      await refresh();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Uložení se nepovedlo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-extrabold">Generování obrázků</h2>
      {settings === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-brand" />
      ) : (
        <div className="space-y-2">
          <Label htmlFor="default-engine">Výchozí model</Label>
          <Select
            id="default-engine"
            value={settings.defaultEngine ?? ""}
            disabled={saving}
            onChange={(e) => change(e.target.value)}
          >
            {settings.defaultEngine === null && <option value="">Podle konfigurace</option>}
            {settings.engines.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} · {credits(e.credits)} za obrázek
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">
            Nízká kvalita na omalovánky stačí. Střední kreslí víc detailů, ale v testu spotřebovala asi 9× víc tokenů
            a trvala asi 3× déle, proto stojí 2 kredity.
          </p>
          {message && <p className="text-sm text-muted">{message}</p>}
        </div>
      )}
    </Card>
  );
}
