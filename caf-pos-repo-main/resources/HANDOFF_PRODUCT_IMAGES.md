# Handoff → Frontend: product photos on the POS menu

**From:** Backend team
**Date:** 2026-06-15
**Type:** New capability — product images via Cloudflare R2 (presigned direct upload)
**Priority:** Medium (backend is implemented + tested; menu cards currently show plain gradient backgrounds)

---

## Why

The POS menu cards render plain gradient backgrounds today. Store managers want to attach a real photo to each product so the sell screen is easier to scan. The backend now stores an `image_url` on every product and exposes endpoints to upload images straight to a Cloudflare R2 bucket. The frontend work is: (1) an upload control in the menu/product builder, and (2) rendering `image_url` as the card background where present.

## How uploads work (presigned direct upload)

The browser uploads the file **directly to R2** — it does *not* stream through our API. The flow is **3 calls**:

```
1. POST  /products/{id}/image-upload-url   → backend returns a short-lived signed URL
2. PUT   {upload_url}  (raw file bytes)    → browser uploads straight to R2
3. PUT   /products/{id}/image  {key}       → backend verifies + saves image_url
```

After step 3 the product's `image_url` is set and comes back on every product read.

> Why this shape: the signed URL keeps R2 credentials server-side, and the confirm step (3) lets the backend verify the object actually landed and reject keys that don't belong to this store/product — so `image_url` can never be pointed at an arbitrary URL.

## Endpoints

All under `/products`, all writes require **OWNER or MANAGER** role. (`api/app/api/v1/products.py`)

| Method & path | Purpose |
|---|---|
| `POST /products/{id}/image-upload-url` | Get a presigned PUT URL for one image. Does not change the product. |
| `PUT /products/{id}/image` | Confirm a finished upload; sets `image_url`, returns the product. |
| `DELETE /products/{id}/image` | Remove the product's image (clears `image_url`, deletes the object). |

`image_url` (string \| null) is now also returned on `GET /products`, `GET /products/{id}`, and after create/update — render it directly.

### Request / response shapes

**Step 1 — request a URL** (`POST …/image-upload-url`):
```json
// request
{ "content_type": "image/jpeg" }
```
```json
// response
{
  "upload_url": "https://<account>.r2.cloudflarestorage.com/...&X-Amz-Signature=...",
  "key": "stores/<store_id>/products/<product_id>/<cuid>.jpg",
  "public_url": "https://pub-xxxx.r2.dev/stores/<store_id>/products/<product_id>/<cuid>.jpg",
  "expires_in": 300
}
```

Allowed `content_type` values: **`image/jpeg`, `image/png`, `image/webp`** (anything else → `422`).
The `upload_url` is valid for **`expires_in` seconds (300 = 5 min)** — request it at the moment the user picks a file, not earlier.

**Step 2 — upload to R2** (`PUT {upload_url}`):
- Method **PUT**, body = the **raw File/Blob** (not multipart, no FormData).
- Header **`Content-Type` MUST exactly match** the `content_type` you sent in step 1, or R2 rejects the signature.
- Do **not** send Authorization or any cookies — the signature is in the URL.

**Step 3 — confirm** (`PUT …/image`):
```json
{ "key": "stores/<store_id>/products/<product_id>/<cuid>.jpg" }   // the key from step 1
```
Returns the full product (`ProductRead`) with `image_url` populated (= the `public_url` from step 1).

## Reference implementation

```js
// Returns the new image_url, or throws.
async function uploadProductImage(productId, file) {
  // 1. presigned URL
  const { upload_url, key } = await api(
    `/products/${productId}/image-upload-url`,
    { method: "POST", body: JSON.stringify({ content_type: file.type }) }
  );

  // 2. PUT raw bytes straight to R2 — Content-Type MUST match
  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error(`R2 upload failed: ${put.status}`);

  // 3. confirm → backend saves image_url
  const product = await api(`/products/${productId}/image`, {
    method: "PUT",
    body: JSON.stringify({ key }),
  });
  return product.image_url;
}
```

```jsx
// Menu card: photo when present, else keep the existing gradient class
<div
  className="menu-card"        // gradient lives here as the fallback
  style={product.image_url
    ? { backgroundImage: `url(${product.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined}
/>
```

## What the frontend needs to build

1. **Product/menu builder — image control:** a file picker (`accept="image/jpeg,image/png,image/webp"`) that runs the 3-step flow above, shows upload progress, and a "Remove photo" button wired to `DELETE /products/{id}/image`.
2. **Menu card rendering:** use `image_url` as the card background; fall back to today's gradient when it's `null`.
3. **Recommended — client-side downscale before upload:** resize to ~800px longest edge and re-encode (canvas → `toBlob`, ideally `image/webp`) so cards load fast and storage stays small. Set `content_type` to the encoded type.

## Gotchas

- **Create flow:** `image_url` is **not** accepted on product *create* — the upload key needs the product id. Create the product first, then upload. (For a "new product" form, save the product, then enable the image control.)
- **Content-Type mismatch** between step 1 and step 2 is the #1 cause of a 403 from R2. Use the same value for both.
- **Caching:** the key includes a unique cuid, so a replaced image gets a new URL — no cache-busting query string needed.
- **Storage not configured →** the upload-url call returns `422 "Image storage (R2) is not configured on this server"`. If you see this in an environment, the R2 env vars aren't set yet (backend/ops task, not frontend).

## Acceptance (frontend)

- A manager can pick a JPG/PNG/WebP for a product and, after upload, the product round-trips with a non-null `image_url`.
- The menu card shows the uploaded photo; products without a photo still show the gradient.
- "Remove photo" clears the image and the card reverts to the gradient.
- A `>5 min` stale picker re-requests a fresh `upload_url` rather than failing silently (or surfaces the R2 error).

## Source references

- Model: `api/app/models/catalog.py` (`Product.image_url`)
- Schemas: `api/app/schemas/catalog.py` (`ProductRead`, `ImageUploadRequest`, `ImageUploadResponse`, `ImageConfirm`)
- Routes: `api/app/api/v1/products.py` (`products_image_upload_url`, `products_confirm_image`, `products_delete_image`)
- Service: `api/app/services/catalog.py` (`create_product_image_upload`, `confirm_product_image`, `clear_product_image`)
- R2 client: `api/app/core/storage.py`
- Migration: `api/alembic/versions/0025_product_image_url.py`
