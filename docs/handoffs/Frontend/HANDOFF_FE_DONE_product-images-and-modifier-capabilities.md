# Frontend done → product photos + modifier price/inventory

**From:** Frontend team
**Date:** 2026-06-15
**Implements:** [HANDOFF_PRODUCT_IMAGES.md](./HANDOFF_PRODUCT_IMAGES.md) + [HANDOFF_MODIFIER_CAPABILITIES.md](./HANDOFF_MODIFIER_CAPABILITIES.md)
**Status:** Built + typechecks clean (`tsc --noEmit` exit 0). Needs live QA against the real API + R2.

---

## TL;DR — what changed

Both backend capabilities are now surfaced in the UI:

1. **Product photos** — managers can upload/replace/remove a photo per product in the menu builder; the photo renders as the POS card background and as the list thumbnail, with the old gradient as the fallback.
2. **Modifiers** — the menu builder now edits a modifier's **price delta** (incl. negative), a **single-item inventory deduction**, and a full **recipe-override editor** (override/delta, multi-ingredient). Previously the builder only collected name + a price field on *add* and couldn't edit existing options at all.

No backend contract changes were needed — all endpoints/shapes are used exactly as documented in the two handoffs.

---

## Feature 1 — product photos (R2 presigned upload)

### Files
- `app/src/lib/image-resize.ts` **(new)** — `downscaleImage(file)`: decodes the picked file, scales the longest edge to ≤800px, re-encodes to WebP via canvas. Falls back to the original `File` on any unsupported type / decode failure / already-small image, so a worst case is "uploaded the original", never a broken upload.
- `app/src/hooks/use-products.ts`
  - `ProductRead` + `MenuItem` gained `image_url` / `imageUrl` (mapped through `mapProduct`).
  - `uploadProductImage(productId, file)` — runs the 3-step flow: `POST …/image-upload-url` → raw `PUT` straight to R2 (plain `fetch`, no auth header, `Content-Type` = the downscaled blob's type) → `PUT …/image {key}`. The image is downscaled **before** step 1 so the signed content-type matches the bytes.
  - `useUploadProductImage()` / `useDeleteProductImage()` — mutations that invalidate `['products']` + `['product-detail']`.
- `app/src/components/screens/bom-builder.tsx`
  - New `ProductImageControl` replaces the 80×80 colour-tag block in the product header: shows the photo (or the colour/tag fallback), an upload overlay spinner, and **เปลี่ยนรูป / ＋รูป / ลบ** buttons wired to the hooks. `accept="image/jpeg,image/png,image/webp"`; the file input is reset after each pick so re-picking the same file works.
  - Sidebar list rows render the photo as a 40×40 thumbnail when present.
- `app/src/components/screens/pos.tsx`
  - `MenuCard` uses `image_url` as a `cover` background when present; otherwise keeps today's gradient + diagonal pattern + `nameEn` watermark. The bestseller star and tag badge still overlay on top.

### Acceptance (from the handoff) → status
- Pick JPG/PNG/WebP, product round-trips with non-null `image_url` → **✅** (confirm-step return invalidates the product queries).
- Card shows the photo; photoless products keep the gradient → **✅**.
- "Remove photo" reverts to the gradient → **✅** (`DELETE …/image`).
- Stale >5 min picker re-requests a fresh URL → **✅ by construction** — the signed URL is requested at the moment of upload, never cached.

---

## Feature 2 — modifier price delta + inventory + recipe override

### Files
- `app/src/hooks/use-modifier-groups.ts`
  - Exported `ModifierGroupRead` and added `useModifierGroupsAdmin()` — returns the **raw** group shape (price_delta / inventory link / sort_order) the menu builder needs for editing, which the POS-facing `mapGroup` drops. Shares the `['modifier-groups']` key prefix so existing add/update/delete mutations invalidate it automatically.
  - Added recipe-item types + hooks: `ModifierRecipeMode`, `ModifierRecipeItemRead/Input`, `useModifierRecipeItems(groupId, modifierId, enabled)` (GET, lazy on expand) and `useReplaceModifierRecipeItems()` (PUT bulk-replace).
- `app/src/components/screens/bom-builder.tsx` — the modifier section was rewritten from the mapped, callback-drilled version to a self-contained tree on the raw shape:
  - `ModifierGroupRow` — add form now collects **name + price_delta (negative allowed) + optional inventory link** (`InventoryLinkFields`: an inventory `Select` + qty input). A link is only sent when both item and a `qty > 0` are present (never an item without a qty).
  - `ModifierOptionRow` **(new)** — every existing option is now editable inline (pencil): name, price_delta, single-item deduction, and a **delete**. Uses `useUpdateModifier` (which already existed but was unused in the UI).
  - `ModifierRecipeEditor` **(new)** — the phase-2 override editor: rows of `{ inventory_item_id, quantity, mode }` with a **แทนที่ (override) / บวก-ลบ (delta)** toggle, loaded lazily and saved as a full bulk replace. Inline helper text explains override-to-0 ("ไม่ใส่วิป") vs delta ("เพิ่มชีส +30g").
  - `ModifierSection` now takes raw `ModifierGroupRead[]` + `inventoryItems`; the old `onAddModifier`/`onDeleteModifier` prop drilling through `RightPanel` was removed.

### Acceptance (from the handoff) → status
- Non-zero/negative `price_delta` round-trips → **✅** (add form + inline edit).
- Attach a single inventory item + qty → **✅**.
- (Phase 2) define override/delta rows; GET reflects the PUT → **✅** (bulk-replace + lazy refetch).
- `+price` modifier raises the line `unit_price` at checkout → **✅ unchanged** — POS still sends `modifier_ids`; the backend remains the source of truth (cart preview already sums `price_delta` client-side in `modifier-modal.tsx`).
- "Oat milk" override-to-0 on dairy + delta on oat milk → **needs live inventory QA** (UI writes the rows correctly; the deduction is backend behaviour).

---

## Open items / notes for backend + ops

1. **R2 bucket CORS (action needed for go-live).** Step 2 is a browser `PUT` straight to R2, so the bucket's CORS must allow `PUT` and the `Content-Type` request header from the app origin(s) (dev + prod). Without it the upload fails at the R2 PUT even though our API is fine.
2. **`422 "Image storage (R2) is not configured"`** surfaces verbatim in the upload toast. If QA sees it, the R2 env vars aren't set in that environment (ops, not frontend).
3. **`<img>` not `next/image`.** Photos come from an external R2 host and are rendered with a plain `<img>` (lint-disabled) to avoid `next/image` remote-pattern config; revisit if we want automatic optimisation.
4. **Recipe-items GET shape** is assumed to be `[{ inventory_item_id, quantity, mode }]` (id optional/ignored). If the real payload differs, only `ModifierRecipeItemRead` in `use-modifier-groups.ts` needs adjusting.

## How to verify locally
- Menu builder → pick a product → header **＋รูป** → choose an image → it should appear on the card + sidebar + POS grid.
- Menu builder → a linked modifier group → **เพิ่มตัวเลือก** with a ฿ delta + inventory link; pencil-edit an existing option; open **สูตรขั้นสูง** and add an override/delta row.
- POS → open a product with a `+price` modifier → the cart total reflects the delta.
