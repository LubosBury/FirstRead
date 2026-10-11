import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Login } from "./Login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function renderAt(url: string) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Login />
      </MemoryRouter>,
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Login", () => {
  it("prefills the email from an invitation link", () => {
    renderAt("/?email=ucitelka%40example.com");
    expect(container.querySelector<HTMLInputElement>("input#email")?.value).toBe("ucitelka@example.com");
  });

  it("explains an expired or used link", () => {
    renderAt("/?error=INVALID_TOKEN");
    expect(container.textContent).toContain("Odkaz už neplatí nebo byl použitý. Pošlete si nový.");
  });

  it("shows a generic message for other sign-in errors", () => {
    renderAt("/?error=new_user_signup_disabled");
    expect(container.textContent).toContain("Přihlášení se nepovedlo. Zkuste to prosím znovu.");
  });
});
