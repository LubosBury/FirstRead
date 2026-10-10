import { Shuffle } from "lucide-react";
import type { ReactNode } from "react";
import { ImageSlot } from "@/components/ImageSlot";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { FONT_IDS, FONTS } from "@/lib/fonts";
import { czechMonthName, daysInMonth } from "@/lib/months";
import { randomSeed } from "@/lib/prng";
import { cn } from "@/lib/utils";
import type { EditorProps } from "@/templates/types";
import { defaultTitle, MAX_ICON_VARIANTS, type MainPosition, type ReadingChallengeParams } from "./params";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line pb-5 last:border-0">
      <h3 className="text-sm font-extrabold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

const POSITIONS: { id: MainPosition; label: string }[] = [
  { id: "left", label: "Vlevo" },
  { id: "center", label: "Uprostřed" },
  { id: "right", label: "Vpravo" },
];

export function ReadingChallengeEditor({ params: p, onChange }: EditorProps<ReadingChallengeParams>) {
  const set = (patch: Partial<ReadingChallengeParams>) => onChange({ ...p, ...patch });

  /** Follows the month with the title and count, unless the teacher changed them. */
  function setMonth(year: number, month: number) {
    const patch: Partial<ReadingChallengeParams> = { year, month };
    if (p.title === defaultTitle(p.month)) patch.title = defaultTitle(month);
    if (p.count === daysInMonth(p.year, p.month)) patch.count = daysInMonth(year, month);
    set(patch);
  }

  return (
    <div className="space-y-5">
      <Section title="Měsíc">
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div>
            <Label htmlFor="month">Měsíc</Label>
            <Select id="month" value={p.month} onChange={(e) => setMonth(p.year, Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {czechMonthName(i + 1)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="year">Rok</Label>
            <Input
              id="year"
              type="number"
              min={2000}
              max={2100}
              value={p.year}
              onChange={(e) => {
                const year = Number(e.target.value);
                if (year >= 2000 && year <= 2100) setMonth(year, p.month);
              }}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="count">Počet obrázků k vybarvení</Label>
          <Input
            id="count"
            type="number"
            min={1}
            max={62}
            value={p.count}
            onChange={(e) => set({ count: Math.max(1, Math.min(62, Number(e.target.value) || 1)) })}
          />
          <p className="mt-1 text-xs text-muted">Podle počtu dní v měsíci ({daysInMonth(p.year, p.month)}).</p>
        </div>
      </Section>

      <Section title="Nadpis">
        <div>
          <Label htmlFor="title">Text nadpisu</Label>
          <Input id="title" value={p.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="font">Písmo</Label>
          <Select id="font" value={p.font} onChange={(e) => set({ font: e.target.value as ReadingChallengeParams["font"] })}>
            {FONT_IDS.map((id) => (
              <option key={id} value={id}>
                {FONTS[id].label}
              </option>
            ))}
          </Select>
        </div>
        <Check checked={p.uppercase} onChange={(uppercase) => set({ uppercase })}>
          Velkými tiskacími písmeny
        </Check>
      </Section>

      <Section title="Hlavní obrázek">
        <ImageSlot
          preset="main"
          max={1}
          addLabel="Vybrat"
          value={p.mainImage.imageId ? [p.mainImage.imageId] : []}
          onChange={(ids) => set({ mainImage: { ...p.mainImage, imageId: ids[0] ?? null } })}
        />
        <div>
          <Label>Umístění dole</Label>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
            {POSITIONS.map((pos) => (
              <button
                key={pos.id}
                type="button"
                aria-pressed={p.mainImage.position === pos.id}
                onClick={() => set({ mainImage: { ...p.mainImage, position: pos.id } })}
                className={cn(
                  "rounded-lg py-1.5 text-sm font-semibold",
                  p.mainImage.position === pos.id ? "bg-surface shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {pos.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="scale">Velikost</Label>
          <input
            id="scale"
            type="range"
            min={0.6}
            max={1.4}
            step={0.05}
            value={p.mainImage.scale}
            onChange={(e) => set({ mainImage: { ...p.mainImage, scale: Number(e.target.value) } })}
            className="w-full accent-brand"
          />
        </div>
      </Section>

      <Section title="Obrázky k vybarvení">
        <ImageSlot
          preset="icon"
          max={MAX_ICON_VARIANTS}
          addLabel="Přidat"
          value={p.icons}
          onChange={(icons) => set({ icons })}
        />
        <p className="text-xs text-muted">Více variant (až {MAX_ICON_VARIANTS}) se na listu náhodně střídá.</p>
        <Button variant="secondary" onClick={() => set({ seed: randomSeed() })}>
          <Shuffle className="h-4 w-4" /> Zamíchat rozmístění
        </Button>
        <Check checked={p.jitter} onChange={(jitter) => set({ jitter })}>
          Natočit a zrcadlit obrázky náhodně
        </Check>
      </Section>

      <Section title="Tisk">
        <Check checked={p.lineArt} onChange={(lineArt) => set({ lineArt })}>
          Vyčistit obrázky na černé obrysy (doporučeno)
        </Check>
      </Section>
    </div>
  );
}
