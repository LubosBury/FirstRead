import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeProvider, useMe } from "@/hooks/useMe";
import { InviteAccept } from "./InviteAccept";
import { Login } from "./Login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function Probe() {
  const { me } = useMe();
  return <p>{me ? `in as ${me.user.email}` : "signed out"}</p>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** /api/me answers 401 until the invite is accepted. */
function mockApi(acceptStatus: number) {
  let signedIn = false;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/me") return signedIn ? json(200, { user: { id: "u", email: "u@example.com", name: "" } }) : json(401, {});
    if (url === "/api/auth/invite/accept") {
      signedIn = acceptStatus === 200;
      return acceptStatus === 200 ? json(200, { status: true }) : json(acceptStatus, { code: "INVALID_INVITE", message: "x" });
    }
    return json(404, {});
  });
}

async function renderAt(url: string) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <MeProvider>
          <Probe />
          <Routes>
            <Route path="/invite" element={<InviteAccept />} />
            <Route path="/" element={<Login />} />
          </Routes>
        </MeProvider>
      </MemoryRouter>,
    ),
  );
}

const button = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Přihlásit se")!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("InviteAccept", () => {
  it("does nothing until the button is pressed, then signs in", async () => {
    const fetch = mockApi(200);
    await renderAt("/invite?token=abc&email=u%40example.com");
    expect(fetch.mock.calls.some((c) => String(c[0]) === "/api/auth/invite/accept")).toBe(false);

    await act(async () => button().click());
    const call = fetch.mock.calls.find((c) => String(c[0]) === "/api/auth/invite/accept")!;
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(String(call[1]?.body))).toEqual({ token: "abc" });
    expect(container.textContent).toContain("in as u@example.com");
  });

  it("falls back to the login form with the email when the invitation no longer works", async () => {
    mockApi(400);
    await renderAt("/invite?token=used&email=u%40example.com");
    await act(async () => button().click());
    expect(container.textContent).toContain("Pozvánka už neplatí nebo byla použitá. Pošlete si přihlašovací odkaz.");
    expect(container.querySelector<HTMLInputElement>("input#email")?.value).toBe("u@example.com");
  });
});
