# Shared Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins share their own pictures into a free library ("Knihovna zdarma") that every signed-in user can pick from.

**Architecture:** Two nullable columns on `images` (`shared_at` = listed now, `first_shared_at` = readable by everyone, never cleared). A new read helper widens image reads to "owner or ever shared". A list endpoint feeds a new picker tab, and an admin endpoint toggles sharing from the "Moje obrázky" page.

**Tech Stack:** Hono on Cloudflare Workers, D1 (SQLite), React 19 + Tailwind 4, Vitest with `@cloudflare/vitest-plugin`.

Spec: [`docs/superpowers/specs/2026-10-11-shared-library-design.md`](../specs/2026-10-11-shared-library-design.md)

## Global Constraints

- UI copy is Czech. Code, comments and docs are English.
- Only standard hyphens "-" in any text. No em or en dashes.
- Delete stays owner-only. Sharing is admin-only and only for the admin's own image.
- No new dependencies.
- Checks before every commit: `npm run lint`, `npm run typecheck`, `npm test`.

---

### Task 1: Worker - share, list and read shared pictures

**Files:**
- Create: `migrations/0003_shared_images.sql`
- Modify: `worker/images.ts` (row type, `publicImage`, `saveImage`, new `getReadableImage`)
- Modify: `worker/routes/images.ts` (read via `getReadableImage`, new `GET /shared-images`)
- Modify: `worker/routes/admin.ts` (new `PUT /admin/images/:id/shared`)
- Modify: `worker/routes/generations.ts:46` (reference via `getReadableImage`)
- Test: `worker/api.test.ts` (new `describe("shared library")`, placed before `describe("scheduled")`)

**Interfaces:**
- Produces: `GET /api/shared-images?slot=main|icon` → `PublicImage[]`. `PUT /api/admin/images/:id/shared` body `{ shared: boolean }` → `{ shared: boolean; everShared: boolean }`. Every public image gains `shared: boolean` and `everShared: boolean`.

- [ ] **Step 1: Write the failing tests** in `worker/api.test.ts`, before `describe("scheduled", ...)`:

```ts
describe("shared library", () => {
  type Img = { id: string; shared: boolean; everShared: boolean };
  const share = (cookie: string, id: string, shared: boolean) =>
    api(`/admin/images/${id}/shared`, { ...json({ shared }), method: "PUT", cookie });
  const library = async (cookie: string, slot?: string) =>
    (await (await api(`/shared-images${slot ? `?slot=${slot}` : ""}`, { cookie })).json()) as Img[];
  const uploadAs = async (cookie: string) => (await (await upload(cookie, PNG)).json()) as Img;

  it("lets only admins share, and only their own pictures", async () => {
    const own = await uploadAs(teacher);
    expect((await share(teacher, own.id, true)).status).toBe(403);
    expect((await share(admin, own.id, true)).status).toBe(404);
  });

  it("validates the request", async () => {
    const img = await uploadAs(admin);
    expect((await api(`/admin/images/${img.id}/shared`, { ...json({}), method: "PUT", cookie: admin })).status).toBe(400);
    expect((await api("/shared-images?slot=poster", { cookie: teacher })).status).toBe(400);
  });

  it("offers a shared picture to everyone signed in", async () => {
    const img = await uploadAs(admin);
    expect(img).toMatchObject({ shared: false, everShared: false });
    expect((await api(`/images/${img.id}`, { cookie: teacher })).status).toBe(404);

    const res = await share(admin, img.id, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shared: true, everShared: true });

    expect((await library(teacher)).some((i) => i.id === img.id)).toBe(true);
    expect((await api(`/images/${img.id}`, { cookie: teacher })).status).toBe(200);
    const own = (await (await api("/images", { cookie: admin })).json()) as Img[];
    expect(own.find((i) => i.id === img.id)).toMatchObject({ shared: true, everShared: true });
    // Still the admin's picture: nobody else can delete it.
    expect((await api(`/images/${img.id}`, { method: "DELETE", cookie: teacher })).status).toBe(404);
  });

  it("works as an AI reference for other users", async () => {
    const img = await uploadAs(admin);
    await share(admin, img.id, true);
    await api("/admin/grant", { ...json({ email: "teacher@example.com", amount: 1 }), cookie: admin });
    const res = await api("/generations", { ...json({ slot: "main", prompt: "", referenceImageId: img.id }), cookie: teacher });
    expect(res.status).toBe(201);
  });

  it("keeps an unshared picture readable for sheets that use it", async () => {
    const img = await uploadAs(admin);
    await share(admin, img.id, true);
    const res = await share(admin, img.id, false);
    expect(await res.json()).toEqual({ shared: false, everShared: true });
    expect((await library(teacher)).some((i) => i.id === img.id)).toBe(false);
    expect((await api(`/images/${img.id}`, { cookie: teacher })).status).toBe(200);
  });

  it("takes a deleted picture away from everyone", async () => {
    const img = await uploadAs(admin);
    await share(admin, img.id, true);
    expect((await api(`/images/${img.id}`, { method: "DELETE", cookie: admin })).status).toBe(204);
    expect((await library(teacher)).some((i) => i.id === img.id)).toBe(false);
    expect((await api(`/images/${img.id}`, { cookie: teacher })).status).toBe(404);
  });

  it("lists pictures by slot, uploads in both", async () => {
    await api("/admin/grant", { ...json({ email: "admin@example.com", amount: 1 }), cookie: admin });
    const gen = await api("/generations", { ...json({ slot: "main", prompt: "medvídek" }), cookie: admin });
    const main = ((await gen.json()) as { image: Img }).image;
    const upl = await uploadAs(admin);
    await share(admin, main.id, true);
    await share(admin, upl.id, true);

    const icons = await library(teacher, "icon");
    expect(icons.some((i) => i.id === main.id)).toBe(false);
    expect(icons.some((i) => i.id === upl.id)).toBe(true);
    const mains = await library(teacher, "main");
    expect(mains.some((i) => i.id === main.id)).toBe(true);
    expect(mains.some((i) => i.id === upl.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project worker -t "shared library"`
Expected: FAIL (404 on `/admin/images/...`, missing `shared` fields).

- [ ] **Step 3: Add the migration** `migrations/0003_shared_images.sql`:

```sql
-- The free library: admins share their own pictures with everyone signed in.
-- shared_at: listed in the library now; cleared on unshare.
-- first_shared_at: set on the first share and never cleared, so sheets that
-- already use the picture keep it. Deleting the picture is the takedown.
ALTER TABLE images ADD COLUMN shared_at TEXT;
ALTER TABLE images ADD COLUMN first_shared_at TEXT;
CREATE INDEX images_shared ON images (shared_at DESC) WHERE shared_at IS NOT NULL;
```

- [ ] **Step 4: Extend `worker/images.ts`**

In `ImageRow`, after `created_at: string;`:

```ts
  /** Set while the picture is in the shared library. */
  shared_at: string | null;
  /** Set on the first share and never cleared: other users' sheets may use it. */
  first_shared_at: string | null;
```

In `publicImage`, after `createdAt: r.created_at,`:

```ts
  shared: !!r.shared_at,
  everShared: !!r.first_shared_at,
```

In `saveImage`, add `shared_at: null, first_shared_at: null,` to the `row` literal after `created_at`. The INSERT stays as is; the columns default to NULL.

Replace the `getOwnedImage` doc comment and add the read helper below it:

```ts
/** For changes (delete, share): only ever looks up images by owner. */
export function getOwnedImage(db: D1Database, userId: string, id: string) {
  return db.prepare("SELECT * FROM images WHERE id = ? AND user_id = ?").bind(id, userId).first<ImageRow>();
}

/** For reads: the owner, or anyone signed in once the picture has been shared. */
export function getReadableImage(db: D1Database, userId: string, id: string) {
  return db
    .prepare("SELECT * FROM images WHERE id = ? AND (user_id = ? OR first_shared_at IS NOT NULL)")
    .bind(id, userId)
    .first<ImageRow>();
}
```

- [ ] **Step 5: Routes**

`worker/routes/images.ts`: import `z` from `zod`, `badRequest` from `../app`, `getReadableImage` from `../images`. In `GET /images/:id`, call `getReadableImage` instead of `getOwnedImage`. Add, after `GET /images`:

```ts
const sharedQuery = z.object({ slot: z.enum(["main", "icon"]).optional() });

/** The free library. Uploads have no slot, so they show for both. */
images.get("/shared-images", async (c) => {
  const parsed = sharedQuery.safeParse(c.req.query());
  if (!parsed.success) return badRequest(c, "Neznámý typ obrázku.");
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, g.provider AS g_provider, g.model AS g_model, g.quality AS g_quality
     FROM images i LEFT JOIN generations g ON g.id = i.generation_id
     WHERE i.shared_at IS NOT NULL AND (?1 IS NULL OR g.slot IS NULL OR g.slot = ?1)
     ORDER BY i.shared_at DESC LIMIT 500`,
  )
    .bind(parsed.data.slot ?? null)
    .all<ImageRow>();
  return c.json(results.map(publicImage));
});
```

`worker/routes/admin.ts`: import `getOwnedImage, type ImageRow` from `../images`. Add at the end:

```ts
const shareBody = z.object({ shared: z.boolean() });

/** Admins share their own pictures only. Delete stays the owner's takedown. */
admin.put("/admin/images/:id/shared", async (c) => {
  const parsed = shareBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Chybí, jestli obrázek sdílet.");
  const row = await getOwnedImage(c.env.DB, c.get("user").id, c.req.param("id"));
  if (!row) return notFound(c);
  const now = new Date().toISOString();
  const updated = parsed.data.shared
    ? await c.env.DB.prepare(
        `UPDATE images SET shared_at = COALESCE(shared_at, ?1), first_shared_at = COALESCE(first_shared_at, ?1)
         WHERE id = ?2 RETURNING *`,
      )
        .bind(now, row.id)
        .first<ImageRow>()
    : await c.env.DB.prepare("UPDATE images SET shared_at = NULL WHERE id = ? RETURNING *").bind(row.id).first<ImageRow>();
  if (!updated) return notFound(c);
  return c.json({ shared: !!updated.shared_at, everShared: !!updated.first_shared_at });
});
```

`worker/routes/generations.ts`: import `getReadableImage` instead of `getOwnedImage`, and use it for the reference image lookup.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project worker`
Expected: PASS, including the existing "refuses someone else's reference image" (never shared).

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck
git add migrations/0003_shared_images.sql worker/
git commit -m "Let admins share pictures into a free library"
```

### Task 2: Web - picker tab, share toggle, delete warning

**Files:**
- Modify: `src/lib/api.ts` (type + 2 calls)
- Modify: `src/components/ImagePicker.tsx` (new tab, shared `PickGrid`, `confirmDelete`)
- Modify: `src/pages/Library.tsx` (admin toggle, delete warning, hint)
- Modify: `README.md` (one line about the library)

**Interfaces:**
- Consumes: Task 1 endpoints and the `shared` / `everShared` fields.
- Produces: `api.sharedImages(slot)`, `api.setShared(id, shared)`, exported `confirmDelete(img)` from `ImagePicker.tsx`.

- [ ] **Step 1: `src/lib/api.ts`**

In `LibraryImage`, after `source`:

```ts
  /** In the free library now. */
  shared: boolean;
  /** Was ever shared, so other users' sheets may use it. */
  everShared: boolean;
```

In `api`, after `deleteImage`:

```ts
  sharedImages: (slot: "main" | "icon") => request<LibraryImage[]>(`/shared-images?slot=${slot}`),
  setShared: (id: string, shared: boolean) =>
    request<{ shared: boolean; everShared: boolean }>(`/admin/images/${id}/shared`, send("PUT", { shared })),
```

- [ ] **Step 2: `src/components/ImagePicker.tsx`**

Add, below `Thumb`:

```tsx
/** A picture that was ever shared may sit on other people's sheets. */
export function confirmDelete(img: LibraryImage) {
  return confirm(
    img.everShared
      ? "Smazat obrázek? Byl ve sdílené knihovně, takže zmizí i z listů ostatních uživatelů."
      : "Smazat obrázek? Listy, které ho používají, ho ztratí.",
  );
}

function PickGrid({
  images,
  empty,
  onPick,
  onReference,
  onDelete,
}: {
  images: LibraryImage[] | null;
  empty: string;
  onPick: (img: LibraryImage) => void;
  onReference: (img: LibraryImage) => void;
  onDelete?: (img: LibraryImage) => void;
}) {
  if (images === null) return <Loader2 className="mx-auto my-8 h-6 w-6 animate-spin text-brand" />;
  if (images.length === 0) return <p className="py-8 text-center text-muted">{empty}</p>;
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {images.map((img) => (
        <li key={img.id} className="group relative">
          <button type="button" onClick={() => onPick(img)} className="block w-full" title={img.label ?? undefined}>
            <Thumb src={img.url} className="aspect-square w-full group-hover:border-brand" />
          </button>
          <div className="mt-1 flex justify-between">
            <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => onReference(img)}>
              Předloha pro AI
            </button>
            {onDelete && (
              <button type="button" aria-label="Smazat" className="text-muted hover:text-danger" onClick={() => onDelete(img)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

In `ImagePicker`:
- `type Tab = "generate" | "library" | "shared" | "upload";`
- State: `const [shared, setShared] = useState<LibraryImage[] | null>(null);`
- Effect, loading once per opened picker:

```tsx
  useEffect(() => {
    if (open && shared === null) api.sharedImages(preset).then(setShared, () => setShared([]));
  }, [open, shared, preset]);
```

- `remove`: `if (!confirmDelete(img)) return;`, and after the delete also `setShared(null);` so a deleted shared picture leaves the tab.
- Tabs, with the library tab hidden while empty:

```tsx
  const tabs: { id: Tab; label: string; icon: typeof Sparkles }[] = [
    { id: "generate", label: "Vygenerovat", icon: Sparkles },
    { id: "library", label: "Moje obrázky", icon: Library },
    ...(shared?.length ? [{ id: "shared" as const, label: "Knihovna zdarma", icon: Gift }] : []),
    { id: "upload", label: "Nahrát vlastní", icon: Upload },
  ];
```

  Import `Gift` from `lucide-react`. Four tabs don't fit a phone with icons, so the tab icon gets `className="hidden h-4 w-4 shrink-0 sm:block"`, and the tab button gets `text-center leading-tight`.
- Replace the library tab body with `<PickGrid images={library} empty="Zatím tu nic není. Obrázek vygenerujte nebo nahrajte." onPick={pick} onReference={takeAsReference} onDelete={remove} />`.
- New tab body:

```tsx
      {tab === "shared" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Hotové obrázky pro všechny. Použít je můžete zdarma.</p>
          <PickGrid images={shared} empty="Knihovna je zatím prázdná." onPick={pick} onReference={takeAsReference} />
        </div>
      )}
```

- [ ] **Step 3: `src/pages/Library.tsx`**

- Imports: `confirmDelete` from `@/components/ImagePicker`, `useMe` from `@/hooks/useMe`, `cn` from `@/lib/utils`.
- `const { me } = useMe();`
- `remove`: `if (!confirmDelete(img)) return;`
- Toggle:

```tsx
  async function toggleShared(img: LibraryImage) {
    setError(null);
    try {
      const flags = await api.setShared(img.id, !img.shared);
      setImages((list) => list?.map((i) => (i.id === img.id ? { ...i, ...flags } : i)) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sdílení se nepovedlo změnit.");
    }
  }
```

- In each item row, before the trash button:

```tsx
                {me?.isAdmin && (
                  <button
                    type="button"
                    onClick={() => toggleShared(img)}
                    aria-pressed={img.shared}
                    title={img.shared ? "Je v knihovně zdarma. Kliknutím ho z ní odeberete." : "Přidat do knihovny zdarma pro všechny"}
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      img.shared ? "bg-brand-soft text-brand" : "border border-line text-muted hover:text-brand",
                    )}
                  >
                    {img.shared ? "Sdílený" : "Sdílet"}
                  </button>
                )}
```

- After the intro paragraph, for admins: `{me?.isAdmin && <p className="text-sm text-muted">Tlačítkem Sdílet přidáte obrázek do knihovny zdarma, kterou při výběru obrázku vidí všichni přihlášení. Odebráním z knihovny se nic nerozbije; smazáním zmizí i z cizích listů.</p>}`

- [ ] **Step 4: README** - after the "Both pictures can be generated..." paragraph:

```markdown
Admins can share their own pictures into a free library ("Knihovna zdarma") that everyone signed in can pick from.
```

- [ ] **Step 5: Checks**

Run: `npm run lint && npm run typecheck && npm test && npx vite build`
Expected: all green.

- [ ] **Step 6: Look at it in the browser**

Run the app locally (`IMAGE_PROVIDER=mock`, admin email in `ADMIN_EMAILS`), sign in via the printed magic link, upload a picture, share it, then sign in as a second user and open the picker: the "Knihovna zdarma" tab is there, picking puts the picture on the sheet. Screenshot both.

- [ ] **Step 7: Commit**

```bash
git add src/ README.md
git commit -m "Offer shared pictures in the image picker"
```
