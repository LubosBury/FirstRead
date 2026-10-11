import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let appleOn = false;

beforeEach(() => {
  appleOn = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input) === "/api/login-methods"
      ? Response.json({ apple: appleOn })
      : Response.json({ error: "not_found", message: "x" }, { status: 404 }),
  );
});

async function renderAt(url: string) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Login />
      </MemoryRouter>,
    ),
  );
}

const appleButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Apple"));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("Login", () => {
  it("prefills the email from an invitation link", async () => {
    await renderAt("/?email=ucitelka%40example.com");
    expect(container.querySelector<HTMLInputElement>("input#email")?.value).toBe("ucitelka@example.com");
  });

  it("explains an expired or used link", async () => {
    await renderAt("/?error=INVALID_TOKEN");
    expect(container.textContent).toContain("Odkaz už neplatí nebo byl použitý. Pošlete si nový.");
  });

  it("shows a generic message for other sign-in errors", async () => {
    await renderAt("/?error=new_user_signup_disabled");
    expect(container.textContent).toContain("Přihlášení se nepovedlo. Zkuste to prosím znovu.");
  });

  it("offers Apple only when the server has it set up", async () => {
    await renderAt("/");
    expect(appleButton()).toBeUndefined();
    act(() => root.unmount());
    container.remove();

    appleOn = true;
    await renderAt("/");
    expect(appleButton()?.textContent?.trim()).toBe("Přihlásit se přes Apple");
  });

  it("explains why Apple sign-in was turned away", async () => {
    await renderAt("/login?error=APPLE_PRIVATE_EMAIL&error_description=Zavolejte%20na%20123");
    expect(container.textContent).toContain("Sdílet můj e-mail");
    // Text from the URL never reaches the page.
    expect(container.textContent).not.toContain("Zavolejte");
  });

  it("says nothing when the teacher cancelled at Apple", async () => {
    await renderAt("/login?error=user_cancelled_authorize");
    expect(container.querySelector(".text-danger")).toBeNull();
  });

  it("does not mistake built-in object keys for known errors", async () => {
    await renderAt("/login?error=constructor");
    expect(container.textContent).toContain("Přihlášení se nepovedlo. Zkuste to prosím znovu.");
  });
});
