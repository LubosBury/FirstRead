/** Comma-separated env list → normalized, lowercased set. */
export function emailSet(list: string | undefined): Set<string> {
  return new Set(
    (list ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const isAllowedEmail = (env: Env, email: string) =>
  emailSet(env.ALLOWED_EMAILS).has(email.trim().toLowerCase());

export const isAdminEmail = (env: Env, email: string) =>
  emailSet(env.ADMIN_EMAILS).has(email.trim().toLowerCase());

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
