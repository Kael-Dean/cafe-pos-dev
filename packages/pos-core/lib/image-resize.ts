// Client-side downscale before uploading a product photo to R2.
//
// Menu cards are small, so we don't need a 12-megapixel original sitting in
// storage and crawling down the wire on the sell screen. We decode the picked
// file, scale the longest edge down to MAX_EDGE, and re-encode as WebP. The
// returned Blob's `type` is what the upload flow must send as `content_type`
// (the R2 signed PUT requires the Content-Type to match exactly).
//
// Anything we can't safely process — an unsupported type, a decode failure, or
// an image already small enough — falls back to the original File untouched,
// so a worst case is "uploaded the original", never "upload broke".

const MAX_EDGE = 800;
const WEBP_QUALITY = 0.85;

export async function downscaleImage(file: File, maxEdge = MAX_EDGE): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxEdge / Math.max(width, height));

    // Already within budget — keep the original bytes (avoid a needless re-encode).
    if (scale >= 1) { bitmap.close?.(); return file; }

    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
