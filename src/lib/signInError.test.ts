import { describe, expect, it } from "vitest";
import { appleSignInError } from "./signInError";

describe("appleSignInError", () => {
  it("stays quiet when there was no error or the teacher cancelled at Apple", () => {
    expect(appleSignInError(null)).toBeNull();
    expect(appleSignInError("user_cancelled_authorize")).toBeNull();
  });

  it("explains the invite-only refusals", () => {
    expect(appleSignInError("not_invited")).toMatch(/pozvánku/);
    expect(appleSignInError("apple_private_email")).toMatch(/Sdílet můj e-mail/);
  });

  it("falls back to a generic message for anything else", () => {
    expect(appleSignInError("<script>")).toBe("Přihlášení přes Apple se nepovedlo. Zkuste to prosím znovu.");
  });
});
