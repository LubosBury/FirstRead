import { Plus, X } from "lucide-react";
import { useState } from "react";
import { ImagePicker, Thumb } from "@/components/ImagePicker";
import { Button } from "@/components/ui/button";

/** Template-agnostic image field: pick from library, upload, or generate. */
export function ImageSlot({
  preset,
  value,
  max,
  onChange,
  addLabel,
}: {
  preset: "main" | "icon";
  value: string[];
  max: number;
  onChange: (ids: string[]) => void;
  addLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const full = value.length >= max;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((id) => (
          <div key={id} className="relative">
            <Thumb src={`/api/images/${id}`} className="h-20 w-20" />
            <button
              type="button"
              aria-label="Odebrat obrázek"
              onClick={() => onChange(value.filter((v) => v !== id))}
              className="absolute -top-2 -right-2 rounded-full border border-line bg-surface p-0.5 text-muted shadow-sm hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {(!full || max === 1) && (
          <Button variant="secondary" className="h-20 min-w-20 flex-col gap-1 text-xs" onClick={() => setOpen(true)}>
            <Plus className="h-5 w-5" />
            {value.length && max === 1 ? "Změnit" : addLabel}
          </Button>
        )}
      </div>
      <ImagePicker
        open={open}
        onClose={() => setOpen(false)}
        preset={preset}
        onPick={(img) => onChange(max === 1 ? [img.id] : [...value.filter((v) => v !== img.id), img.id].slice(0, max))}
      />
    </div>
  );
}
