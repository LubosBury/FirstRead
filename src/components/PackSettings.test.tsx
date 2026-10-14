import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackSettings } from "./PackSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let packs: { id: string; credits: number; priceCzk: number; label: string | null; active: boolean }[];
let puts: { url: string; body: unknown }[];

beforeEach(() => {
  packs = [
    { id: "small", credits: 20, priceCzk: 99, label: null, active: true },
    { id: "medium", credits: 50, priceCzk: 249, label: "Nejoblíbenější", active: true },
    { id: "large", credits: 120, priceCzk: 499, label: null, active: true },
  ];
  puts = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/admin/packs") return Response.json(packs);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push({ url, body });
      packs = packs.map((p) => (url.endsWith(`/${p.id}`) ? { ...p, ...body } : p));
      return Response.json({});
    }
    return Response.json({ error: "not_found", message: "x" }, { status: 404 });
  });
});

async function renderCard() {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root.render(<PackSettings />));
}

const saveButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Uložit balíčky"))!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("PackSettings", () => {
  it("shows the three packs and nothing to save yet", async () => {
    await renderCard();
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(3);
    expect(container.querySelector<HTMLInputElement>("#p-price-medium")?.value).toBe("249");
    expect(container.querySelector<HTMLInputElement>("#p-label-medium")?.value).toBe("Nejoblíbenější");
    expect(saveButton().disabled).toBe(true);
  });

  it("saves only the pack that changed", async () => {
    await renderCard();
    const large = container.querySelectorAll('[role="group"]')[2];
    await act(async () => large.querySelector<HTMLButtonElement>('button[aria-label="Zvýšit"]')!.click());
    await act(async () => large.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(saveButton().disabled).toBe(false);

    await act(async () => saveButton().click());
    expect(puts).toEqual([{ url: "/api/admin/packs/large", body: { credits: 121, priceCzk: 499, label: null, active: false } }]);
    expect(container.textContent).toContain("Uloženo.");
    expect(saveButton().disabled).toBe(true);
  });
});
