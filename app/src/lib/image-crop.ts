// Client-side square crop for a menu photo, run before the upload's downscale.
//
// Menu cards render the photo as a small square (80x80, object-fit:cover), so a
// portrait/landscape source gets center-cropped by the browser with no control
// over framing. This module lets the user frame a 1:1 region first: the crop
// modal tracks a pan/zoom view-state, and on confirm we draw exactly the source
// pixels under the square window onto an N×N canvas and re-encode as WebP — the
// same createImageBitmap → canvas → toBlob('image/webp', 0.85) technique as
// image-resize.ts. The result is a File, so the upload flow's downscaleImage()
// still caps it at 800px on the longest edge for free.
//
// Anything we can't safely process (unsupported type, decode failure, no canvas)
// falls back to the original File untouched, so the worst case is "uploaded the
// uncropped original", never "upload broke".

const MAX_OUT = 800;
const WEBP_QUALITY = 0.85;

/**
 * Pan/zoom view-state describing how the source image is laid out behind a
 * square crop window, in the window's own pixel space.
 *
 * The image is drawn at `naturalW*scale × naturalH*scale` and translated by
 * (offsetX, offsetY) — the position of the image's top-left corner relative to
 * the window's top-left corner. `cropPx` is the on-screen side length of the
 * square window (CSS px); we only need it to convert window → source pixels.
 *
 * Invariant (kept by the modal's clamp): the scaled image fully covers the
 * window, i.e. offset ≤ 0 and offset + scaledSize ≥ cropPx on both axes.
 */
export interface CropState {
  scale: number;
  offsetX: number;
  offsetY: number;
  cropPx: number;
}

export async function cropImageToSquare(file: File, crop: CropState): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const { width: natW, height: natH } = bitmap;

    // Map the square window back onto the source image. The window's top-left in
    // image space is (-offset / scale); its side in source px is (cropPx / scale).
    const { scale, offsetX, offsetY, cropPx } = crop;
    const srcSide = cropPx / scale;
    let sx = -offsetX / scale;
    let sy = -offsetY / scale;

    // Defensive clamp: keep the sampled rect inside the source even if a rounding
    // slip pushed it a hair past the edge (the modal already clamps pan/zoom).
    const side = Math.min(srcSide, natW, natH);
    sx = Math.max(0, Math.min(sx, natW - side));
    sy = Math.max(0, Math.min(sy, natH - side));

    // Output side: the cropped region, never upscaled, capped at MAX_OUT.
    const out = Math.max(1, Math.round(Math.min(side, MAX_OUT)));

    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
    );
    if (!blob) return file;

    return new File([blob], 'crop.webp', { type: 'image/webp' });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
