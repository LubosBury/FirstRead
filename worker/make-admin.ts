/**
 * SQL that makes `email` an admin: inserts the user, or promotes and unbans an
 * existing one. Written the way Better Auth writes users (lowercased email, ISO
 * timestamps, 0/1 booleans) so the new admin can sign in. Used by
 * `npm run make-admin`; no Workers types, so plain Node can import it.
 */
export function makeAdminSql(email: string): string {
  const e = email.trim().toLowerCase();
  // Quotes can't appear in a valid address, which also keeps the literal safe.
  if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(e)) throw new Error(`Not an email address: ${email}`);
  const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
  return `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt, role, banned)
VALUES (lower(hex(randomblob(16))), '', '${e}', 0, NULL, ${now}, ${now}, 'admin', 0)
ON CONFLICT (email) DO UPDATE SET role = 'admin', banned = 0, banReason = NULL, banExpires = NULL, updatedAt = ${now};`;
}
