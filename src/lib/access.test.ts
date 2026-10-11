import { describe, expect, it } from "vitest";
import { ACCESS_LABEL, accessStatus } from "./access";

describe("accessStatus", () => {
  it("is revoked when banned, whatever else", () => {
    expect(accessStatus({ banned: true, emailVerified: true })).toBe("revoked");
    expect(accessStatus({ banned: true, emailVerified: false })).toBe("revoked");
  });

  it("is pending until the first sign-in, then active", () => {
    expect(accessStatus({ banned: false, emailVerified: false })).toBe("pending");
    expect(accessStatus({ banned: false, emailVerified: true })).toBe("active");
  });

  it("has a Czech label for each status", () => {
    expect(ACCESS_LABEL).toEqual({ active: "Aktivní", pending: "Čeká na přihlášení", revoked: "Bez přístupu" });
  });
});
