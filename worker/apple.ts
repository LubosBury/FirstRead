import { Buffer } from "node:buffer";

export type AppleConfig = { clientId: string; teamId: string; keyId: string; privateKey: string };

/** Sign in with Apple is on only when all four values are set. */
export function appleConfig(env: Env): AppleConfig | null {
  const config = {
    clientId: env.APPLE_CLIENT_ID?.trim(),
    teamId: env.APPLE_TEAM_ID?.trim(),
    keyId: env.APPLE_KEY_ID?.trim(),
    privateKey: env.APPLE_PRIVATE_KEY?.trim(),
  };
  return config.clientId && config.teamId && config.keyId && config.privateKey ? (config as AppleConfig) : null;
}

/** Hide My Email addresses; they never match an invite. */
export const isAppleRelayEmail = (email: string) => email.trim().toLowerCase().endsWith("@privaterelay.appleid.com");

// Apple caps the secret at six months. Signing it here from the .p8 key means
// nobody has to remember to rotate it.
const SECRET_TTL_S = 30 * 24 * 60 * 60;

const base64url = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

/**
 * The client secret Apple wants at the token endpoint: an ES256 JWT signed with
 * the Sign in with Apple key (the .p8 file, PKCS#8 PEM).
 */
export async function appleClientSecret(config: AppleConfig, now = Date.now()): Promise<{ secret: string; expiresAt: number }> {
  // Tolerate the key pasted with or without its PEM armor, or with "\n" escapes.
  const der = Buffer.from(
    config.privateKey
      .replace(/-----[A-Z ]+-----/g, "")
      .replace(/\\n/g, "")
      .replace(/\s+/g, ""),
    "base64",
  );
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const exp = iat + SECRET_TTL_S;
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(
    JSON.stringify({ iss: config.teamId, iat, exp, aud: "https://appleid.apple.com", sub: config.clientId }),
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
  return { secret: `${header}.${claims}.${base64url(new Uint8Array(signature))}`, expiresAt: exp * 1000 };
}
