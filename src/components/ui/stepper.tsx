import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { clamp, parseWhole } from "@/lib/wholeNumber";
import { cn } from "@/lib/utils";

const stepButton = "flex w-11 shrink-0 items-center justify-center text-muted hover:text-ink disabled:opacity-40";

/**
 * Whole-number field with − and + buttons, since phones show no spinner. The
 * typed text is kept while editing, so the field can be cleared and retyped;
 * only numbers within bounds reach `onChange`, and leaving the field snaps
 * back to a valid one.
 */
export function Stepper({
  id,
  value,
  min,
  max,
  onChange,
  className,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function type(text: string) {
    setDraft(text);
    const n = parseWhole(text);
    if (n !== null && n >= min && n <= max && n !== value) onChange(n);
  }

  function commit() {
    if (draft === null) return;
    const n = parseWhole(draft);
    if (n !== null && clamp(n, min, max) !== value) onChange(clamp(n, min, max));
    setDraft(null);
  }

  return (
    <div
      className={cn(
        "flex h-11 overflow-hidden rounded-lg border border-line bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 md:h-10",
        className,
      )}
    >
      <button type="button" aria-label="Snížit" className={stepButton} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="h-4 w-4" />
      </button>
      <input
        id={id}
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft ?? String(value)}
        onChange={(e) => type(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="w-full min-w-0 bg-transparent text-center text-base font-semibold text-ink outline-none md:text-sm"
      />
      <button type="button" aria-label="Zvýšit" className={stepButton} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
