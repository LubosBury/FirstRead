import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound, type AppEnv } from "../app";
import { completeGeneration, failGeneration, getBalance, InsufficientCreditsError, startGeneration } from "../credits";
import { isAdminEmail } from "../env";
import { getOwnedImage, publicImage, readImageBytes, saveImage, sniffImageMime } from "../images";
import { ENGINE_IDS } from "../imaging/engines";
import { buildPrompt } from "../imaging/prompts";
import { creditCost, resolveEngine } from "../settings";
import { getProvider, MSG, ProviderError, type ImageInput } from "../imaging/provider";

export const generations = new Hono<AppEnv>();

const body = z
  .object({
    slot: z.enum(["main", "icon"]),
    prompt: z.string().max(500),
    referenceImageId: z.string().max(64).nullish(),
    engine: z.enum(ENGINE_IDS).optional(),
  })
  .refine((b) => b.prompt.trim() || b.referenceImageId, "prompt or reference required");

generations.post("/generations", async (c) => {
  const parsed = body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const badEngine = parsed.error.issues.some((i) => i.path[0] === "engine");
    return badRequest(c, badEngine ? "Neznámý model." : "Napište, co má obrázek zobrazovat.");
  }
  const { slot, prompt, referenceImageId, engine } = parsed.data;
  const user = c.get("user");
  if (engine && !isAdminEmail(c.env, user.email)) {
    return c.json({ error: "forbidden", message: "Výběr modelu je jen pro správce." }, 403);
  }

  const engineId = await resolveEngine(c.env, engine);
  let provider;
  try {
    provider = getProvider(c.env, { engine: engineId ?? undefined });
  } catch (e) {
    console.error("image provider unavailable", e);
    return c.json({ error: "unavailable", message: MSG.config }, 503);
  }

  let reference: ImageInput | undefined;
  if (referenceImageId) {
    const row = await getOwnedImage(c.env.DB, user.id, referenceImageId);
    const bytes = row && (await readImageBytes(c.env, row));
    if (!row || !bytes) return notFound(c);
    reference = { bytes, mime: row.mime };
  }

  const cost = creditCost(c.env, engineId, slot);
  let generationId: string;
  try {
    generationId = await startGeneration(c.env.DB, {
      userId: user.id,
      slot,
      prompt: prompt.trim(),
      referenceImageId: referenceImageId ?? null,
      provider: provider.id,
      model: provider.model,
      quality: provider.quality,
      cost,
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return c.json({ error: "insufficient_credits", message: "Nemáte dost kreditů na další obrázek." }, 402);
    }
    throw e;
  }

  try {
    const result = await provider.generate({ prompt: buildPrompt(slot, prompt, !!reference), reference });
    // Stored and served with the type its bytes prove, not the one claimed.
    const mime = sniffImageMime(result.bytes);
    if (!mime) throw new ProviderError(MSG.failed, `${provider.id}: response is not a PNG/JPEG/WebP image`);
    const image = await saveImage(c.env, {
      userId: user.id,
      bytes: result.bytes,
      mime,
      origin: "generated",
      generationId,
      label: prompt.trim().slice(0, 120) || null,
    });
    // If the stale sweep refunded this one meanwhile, the image is simply free.
    await completeGeneration(c.env.DB, generationId, { imageId: image.id, usage: result.usage });
    return c.json(
      {
        image: publicImage(image),
        source: { provider: provider.id, model: provider.model, quality: provider.quality },
        balance: await getBalance(c.env.DB, user.id),
      },
      201,
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("generation failed", generationId, detail);
    await failGeneration(c.env.DB, generationId, detail);
    const message = e instanceof ProviderError ? e.userMessage : MSG.failed;
    return c.json({ error: "generation_failed", message, balance: await getBalance(c.env.DB, user.id) }, 502);
  }
});
