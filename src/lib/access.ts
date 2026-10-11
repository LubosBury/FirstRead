export type AccessStatus = "active" | "pending" | "revoked";

/** Pending = invited but never signed in; revoked = banned by an admin. */
export function accessStatus(u: { banned: boolean; emailVerified: boolean }): AccessStatus {
  if (u.banned) return "revoked";
  return u.emailVerified ? "active" : "pending";
}

export const ACCESS_LABEL: Record<AccessStatus, string> = {
  active: "Aktivní",
  pending: "Čeká na přihlášení",
  revoked: "Bez přístupu",
};
