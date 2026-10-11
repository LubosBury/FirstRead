# Shared library ("Knihovna zdarma")

Status: approved design, 2026-10-11.

## Context

Every image belongs to one user, and every read is checked against that owner (`getOwnedImage` in `worker/images.ts`). A new user who doesn't want to generate their own pictures has nothing to pick from.

Goal: an admin marks some of their own pictures as shared. Every signed-in user can then pick them, for free, in the image picker.

Sign-in is invite-only (`ALLOWED_EMAILS`), so "free after sign-in" means free for every invited user. Using an existing picture already costs nothing; only generating does.

Hypothesis (judgment, not measured): a ready-made library gets new users to a finished sheet faster, without spending their welcome credits. The metric for that is the share of new users who export a PDF in their first session, not clicks in the library. Measuring it is out of scope here.

### Decisions made with the user

| Topic | Decision |
|---|---|
| Unsharing a picture someone already uses | It disappears from the library, but sheets that use it keep it. Deleting the picture is the hard takedown, also from other users' sheets. |
| Which picker tab opens first | "Vygenerovat", as today. The library is an extra tab. |

### Decisions I made (defaults, override if wrong)

- **Live reference, no copies.** Sheets point at the admin's original image. No duplicate files in R2, and users' own libraries stay clean.
- **Admins share only their own pictures.** Sharing another user's picture raises consent questions and nobody needs it yet.
- **Filtered by slot.** Pictures generated as a main picture only show in the main picker, and repeated pictures only in the icon picker, so a full scene never lands among 2 cm icons. Uploads have no slot and show in both.
- **Shared pictures work as an AI reference** ("Předloha pro AI"), the same as the user's own.
- **The tab is hidden while the library is empty** for that slot.

## Data

Migration `0003_shared_images.sql` adds two nullable columns to `images`:

- `shared_at`: set = listed in the library now. Cleared on unshare.
- `first_shared_at`: set on the first share and never cleared. It makes the picture readable by any signed-in user, which is what keeps other users' sheets working after an unshare.

A partial index on `shared_at` serves the library listing.

## API

- `GET /api/shared-images?slot=main|icon`: the library, for every signed-in user, newest share first. Without `slot`, everything shared.
- `PUT /api/admin/images/:id/shared` with `{ shared: boolean }`: admins only (the existing `/admin/*` guard), and only for the admin's own image (404 otherwise). Sharing again keeps the original `shared_at`. Returns the new `{ shared, everShared }` flags.
- Read access: `GET /api/images/:id` and the AI reference check in `POST /api/generations` allow the owner, or any image with `first_shared_at` set (`getReadableImage`).
- Delete stays owner-only and unchanged.
- The public image shape gains `shared` (listed now) and `everShared` (`first_shared_at` set).

## UI

- **Image picker:** a "Knihovna zdarma" tab after "Moje obrázky". Same grid, with "Předloha pro AI", without delete. The picker loads the library for its slot when it opens and hides the tab when the list is empty.
- **"Moje obrázky" page, admins only:** each picture gets a "Sdílet" / "Sdílený" toggle. Unsharing needs no confirmation, because nothing breaks.
- **Delete confirmation:** for a picture with `everShared`, the confirmation says it also disappears from other users' sheets. This applies on the page and in the picker.

## Testing

Worker integration tests (`worker/api.test.ts`):

- A non-admin can't share (403). An admin can't share someone else's picture (404).
- A shared picture is listed for another user, readable by them, and works as their AI reference.
- After unsharing, it is gone from the list but still readable by id.
- A picture that was never shared stays a 404 for other users.
- Deleting a shared picture removes it for everyone.
- The slot filter: a main picture is not listed for `slot=icon`, and an upload is listed for both.

## Out of scope

Categories and search, manual ordering, printing straight from the library, sharing other users' pictures, and the activation metric (it needs an export event first).
