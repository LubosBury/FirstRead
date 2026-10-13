import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { MeProvider } from "@/hooks/useMe";
import { Credits } from "./Credits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const PACKS = [
  { id: "small", credits: 1, priceCzk: 9, label: null },
  { id: "medium", credits: 3, priceCzk: 25, label: "Nejoblíbenější" },
  { id: "large", credits: 50, priceCzk: 1249, label: null },
];

const LEDGER = [
  { delta: 50, reason: "purchase", note: null, generationId: null, createdAt: "2026-10-12T08:00:00.000Z" },
  { delta: -1, reason: "generation", note: null, generationId: "g1", createdAt: "2026-10-11T08:00:00.000Z" },
  { delta: 5, reason: "grant", note: "welcome", generationId: null, createdAt: "2026-10-10T08:00:00.000Z" },
];

let balance: number;
let canBuyCredits: boolean;
let checkoutStatus: number;
let calls: string[];
let posted: unknown;

beforeEach(() => {
  balance = 2;
  canBuyCredits = true;
  checkoutStatus = 200;
  calls = [];
  posted = undefined;
  sessionStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === "/api/me") {
      return Response.json({ user: { id: "u", email: "u@example.com", name: "" }, balance, isAdmin: false, canBuyCredits, costs: { main: 1, icon: 1 } });
    }
    if (url === "/api/credits/packs") return Response.json(PACKS);
    if (url === "/api/credits/ledger") return Response.json(LEDGER);
    if (url === "/api/credits/checkout") {
      posted = JSON.parse(String(init?.body));
      return checkoutStatus === 200
        ? Response.json({ url: "https://checkout.stripe.test/pay/abc" })
        : Response.json({ error: "stripe", message: "x" }, { status: checkoutStatus });
    }
    return Response.json({ error: "not_found", message: "x" }, { status: 404 });
  });
});

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

async function renderAt(url: string) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <MeProvider>
          <Where />
          <Routes>
            <Route path="/credits" element={<Credits />} />
          </Routes>
        </MeProvider>
      </MemoryRouter>,
    ),
  );
}

const text = () => container.textContent?.replace(/\u00a0/g, " ") ?? "";
const buttons = () => Array.from(container.querySelectorAll("button"));
const notice = () => container.querySelector('[role="status"]')?.textContent ?? null;
const meCalls = () => calls.filter((u) => u === "/api/me").length;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Credits", () => {
  it("shows the balance and the packs with prices and Czech plurals", async () => {
    await renderAt("/credits");
    expect(container.querySelector('[data-testid="balance"]')?.textContent).toContain("2 kredity");
    expect(text()).toContain("1 kredit");
    expect(text()).toContain("3 kredity");
    expect(text()).toContain("50 kreditů");
    expect(text()).toContain("9,00 Kč za kredit");
    expect(text()).toContain("8,33 Kč za kredit");
    expect(text()).toContain("24,98 Kč za kredit");
    expect(text()).toContain("Nejoblíbenější");
    expect(buttons().map((b) => b.textContent?.replace(/\u00a0/g, " ").trim())).toEqual([
      "Koupit · 9 Kč",
      "Koupit · 25 Kč",
      "Koupit · 1 249 Kč",
    ]);
  });

  it("says that a generated picture stays and is free to reuse", async () => {
    await renderAt("/credits");
    expect(text()).toContain("Každý vygenerovaný obrázek vám zůstává v knihovně a můžete ho použít znovu zdarma.");
  });

  it("lists the history with signed amounts", async () => {
    await renderAt("/credits");
    const rows = Array.from(container.querySelectorAll('[data-testid="ledger"] li')).map((li) => li.textContent);
    expect(rows).toEqual(["12. 10. 2026Nákup kreditů+50", "11. 10. 2026Vygenerovaný obrázek−1", "10. 10. 2026Kredity na uvítanou+5"]);
  });

  it("sends the browser to the payment page of the chosen pack", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await renderAt("/credits");
    await act(async () => buttons()[1].click());
    expect(posted).toEqual({ packId: "medium" });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/pay/abc");
    vi.unstubAllGlobals();
  });

  it("says nothing was charged when the payment page cannot be opened", async () => {
    checkoutStatus = 502;
    await renderAt("/credits");
    await act(async () => buttons()[0].click());
    expect(text()).toContain("Platbu se nepodařilo zahájit, nic jsme vám neúčtovali. Zkuste to prosím znovu.");
    expect(buttons().every((b) => !b.disabled)).toBe(true);
  });

  it("waits for the paid credits, then stops asking", async () => {
    vi.useFakeTimers();
    await renderAt("/credits?status=success");
    expect(notice()).toContain("Kredity právě připisujeme");
    expect(container.querySelector('[data-testid="where"]')?.textContent).toBe("/credits");

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(notice()).toContain("Kredity právě připisujeme");

    balance = 52;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(notice()).toBe("Platba proběhla a kredity máte připsané.");
    expect(container.querySelector('[data-testid="balance"]')?.textContent).toContain("52 kreditů");

    const asked = meCalls();
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(meCalls()).toBe(asked);
  });

  it("does not wait when the credits arrived before the browser came back", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem("credits.balanceBeforeCheckout", "2");
    balance = 52;
    await renderAt("/credits?status=success");
    expect(notice()).toBe("Platba proběhla a kredity máte připsané.");
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(meCalls()).toBe(1);
  });

  it("gives up calmly when the credits do not arrive", async () => {
    vi.useFakeTimers();
    await renderAt("/credits?status=success");
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(notice()).toContain("kredity se zatím nepřipsaly");
    expect(meCalls()).toBe(7);
  });

  it("reassures after a cancelled payment", async () => {
    await renderAt("/credits?status=cancelled");
    expect(notice()).toBe("Platbu jste zrušili. Nic jsme vám neúčtovali.");
    expect(container.querySelector('[data-testid="where"]')?.textContent).toBe("/credits");
    expect(container.querySelector(".text-danger")).toBeNull();
  });

  it("offers nothing to buy when purchases are off", async () => {
    canBuyCredits = false;
    await renderAt("/credits");
    expect(buttons()).toEqual([]);
    expect(calls).not.toContain("/api/credits/packs");
    expect(text()).toContain("požádejte správce o doplnění");
    expect(text()).toContain("Nákup kreditů");
  });
});

describe("AppShell", () => {
  async function renderShell() {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <MeProvider>
            <AppShell>x</AppShell>
          </MeProvider>
        </MemoryRouter>,
      ),
    );
  }

  it("links the credit badge to the credits page", async () => {
    await renderShell();
    const badge = container.querySelector<HTMLAnchorElement>('[data-testid="credit-badge"]');
    expect(badge?.getAttribute("href")).toBe("/credits");
    expect(badge?.textContent).toContain("2 kredity");
  });

  it("puts Kredity in the navigation only when credits can be bought", async () => {
    await renderShell();
    expect(container.querySelector('nav[aria-label="Hlavní navigace"]')?.textContent).toContain("Kredity");
    act(() => root.unmount());
    container.remove();

    canBuyCredits = false;
    await renderShell();
    expect(container.querySelector('nav[aria-label="Hlavní navigace"]')?.textContent).not.toContain("Kredity");
  });
});
