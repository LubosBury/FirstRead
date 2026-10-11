import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { revokeUnprovenAccountAccess } from "better-auth/db";
import { z } from "zod";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "invite:";

/** Only the hash is stored, so a database read does not reveal working links. */
async function identifierFor(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return PREFIX + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

const invalid = () => new APIError("BAD_REQUEST", { code: "INVALID_INVITE", message: "Pozvánka už neplatí." });

/**
 * Invitation links that sign the person in directly. The invitation already
 * proves control of the mailbox, so a second magic-link email adds nothing.
 * Only POST consumes a token: the /invite page sends it when its button is
 * pressed, so mail scanners that prefetch links cannot burn it.
 */
export const inviteLink = () =>
  ({
    id: "invite-link",
    endpoints: {
      createInvite: createAuthEndpoint(
        "/invite/create",
        { method: "POST", body: z.object({ userId: z.string().min(1) }), metadata: { SERVER_ONLY: true } },
        async (ctx) => {
          const { userId } = ctx.body;
          // Only the latest invitation works.
          await ctx.context.adapter.deleteMany({
            model: "verification",
            where: [
              { field: "value", value: userId },
              { field: "identifier", operator: "starts_with", value: PREFIX },
            ],
          });
          const token = generateRandomString(32, "a-z", "A-Z", "0-9");
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: await identifierFor(token),
            value: userId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          });
          return ctx.json({ token });
        },
      ),
      acceptInvite: createAuthEndpoint(
        "/invite/accept",
        { method: "POST", body: z.object({ token: z.string().min(1).max(200) }) },
        async (ctx) => {
          const record = await ctx.context.internalAdapter.consumeVerificationValue(await identifierFor(ctx.body.token));
          // Consuming deletes the row but does not check the expiry.
          if (!record || new Date(record.expiresAt).getTime() < Date.now()) throw invalid();
          let user = await ctx.context.internalAdapter.findUserById(record.value);
          if (!user) throw invalid();
          // Same promotion as magic-link verify: the mailbox is now proven.
          if (!user.emailVerified) user = await revokeUnprovenAccountAccess(ctx, user.id);
          if (!user) throw invalid();
          // The admin plugin refuses banned users here.
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          await ctx.context.adapter.deleteMany({
            model: "verification",
            where: [
              { field: "value", value: user.id },
              { field: "identifier", operator: "starts_with", value: PREFIX },
            ],
          });
          return ctx.json({ status: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
