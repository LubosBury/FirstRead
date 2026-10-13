import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeProvider } from "@/hooks/useMe";
import { ImagePicker } from "./ImagePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let balance: number;
let canBuyCredits: boolean;

beforeEach(() => {
  balance = 0;
  canBuyCredits = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/me") {
      return Response.json({ user: { id: "u", email: "u@example.com", name: "" }, balance, isAdmin: false, canBuyCredits, costs: { main: 1, icon: 1 } });
    }
    return Response.json([]);
  });
});

async function renderPicker() {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MeProvider>
        <ImagePicker open onClose={() => {}} preset="main" onPick={() => {}} />
      </MeProvider>,
    ),
  );
}

const topUp = () => container.querySelector<HTMLAnchorElement>('a[href="/credits"]');
const generate = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Vygenerovat ·"));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ImagePicker with too few credits", () => {
  it("offers a top-up and keeps generating switched off", async () => {
    await renderPicker();
    expect(container.textContent).toContain("Zůstatek: 0 kreditů · na další obrázek nestačí.");
    expect(topUp()?.textContent?.trim()).toBe("Dobít kredity");
    expect(generate()?.disabled).toBe(true);
    expect(container.textContent).not.toContain("požádejte správce");
    // Running low is information, not an alarm.
    expect(container.querySelector(".text-danger, .text-warn")).toBeNull();
  });

  it("points to the admin when credits cannot be bought", async () => {
    canBuyCredits = false;
    await renderPicker();
    expect(topUp()).toBeNull();
    expect(container.textContent).toContain("na další obrázek nestačí, požádejte správce o doplnění.");
    expect(generate()?.disabled).toBe(true);
  });

  it("shows no prompt while the balance covers the picture", async () => {
    balance = 3;
    await renderPicker();
    expect(topUp()).toBeNull();
    expect(container.textContent).toContain("Zůstatek: 3 kredity");
    expect(container.textContent).not.toContain("nestačí");
  });
});
