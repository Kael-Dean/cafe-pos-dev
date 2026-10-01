// One-off tool: render the PWA / home-screen icon set from public/logo.svg.
//
// Run:  node scripts/generate-pwa-icons.mjs   (from the app/ directory)
// Re-run whenever public/logo.svg changes, then commit the regenerated files.
//
// Uses `sharp`, which is already in node_modules as a transitive dependency of
// `next` (its image optimizer). It is deliberately NOT listed in package.json —
// this script only runs on a developer machine, never at build time.
//
// What it does, and why:
//  - logo.svg is 674×524 (not square) and bakes in a full-bleed white rectangle.
//    Dropping that rectangle and trimming to the artwork lets the logo sit on the
//    app's own cream background instead of looking like a white box pasted on it.
//  - "any" icons are a rounded cream tile with transparent corners (reads well on
//    a desktop taskbar / dock of any colour).
//  - "maskable" icons are full-bleed cream with the logo inside the central 60%,
//    so Android's circle / squircle masks never clip it.
//  - apple-touch-icon is fully opaque (iOS paints transparency black).
//  - favicon.ico uses only the rainbow mark: the full lockup with its lettering is
//    unreadable at 16–48px.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(APP_ROOT, 'public', 'logo.svg');
const OUT_DIR = path.join(APP_ROOT, 'public', 'icons');
const FAVICON = path.join(APP_ROOT, 'src', 'app', 'favicon.ico');

// ── Tunables ───────────────────────────────────────────────────────
const BACKGROUND = '#F7F3EC';   // --color-bg (cream); keep in sync with manifest background_color
const ANY_LOGO_RATIO = 0.78;    // logo width as a share of the canvas, "any" icons
const MASKABLE_LOGO_RATIO = 0.6; // central safe zone for maskable icons
const APPLE_LOGO_RATIO = 0.74;
const TILE_RADIUS_RATIO = 0.22; // corner radius of the "any" tile
// The trimmed artwork is the rainbow mark on top and the lettering below it.
// The mark occupies roughly the top 68% of the height; the favicon keeps only that.
const MARK_HEIGHT_RATIO = 0.68;
const FAVICON_MARK_RATIO = 0.9;
// ───────────────────────────────────────────────────────────────────

// The baked-in background: a white path covering the whole 1152×896 design space.
const BACKGROUND_RECT = /<path fill="white"[^>]*d="M0 0L1152 0L1152 896L0 896L0 0Z"\/>/;

async function loadArtwork() {
  const svg = await fs.readFile(SRC, 'utf8');
  if (!BACKGROUND_RECT.test(svg)) {
    throw new Error('logo.svg no longer has the expected white background path — update BACKGROUND_RECT.');
  }
  const transparent = svg.replace(BACKGROUND_RECT, '');
  // 4× the SVG's natural size so every output is a downscale, then crop to the art.
  const raster = await sharp(Buffer.from(transparent), { density: 288 }).png().toBuffer();
  return sharp(raster).trim().png().toBuffer();
}

/** Centre `art` on a square canvas, scaled so its width is `ratio` of the canvas. */
async function compose(art, size, ratio, { rounded = false } = {}) {
  const target = Math.round(size * ratio);
  const logo = await sharp(art)
    .resize({ width: target, height: target, fit: 'inside' })
    .png()
    .toBuffer();

  const tile = sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  }).composite([{ input: logo, gravity: 'centre' }]);

  // sharp runs one composite per pipeline, so materialise the tile before the
  // second step (corner mask, or dropping alpha).
  const flat = await tile.png().toBuffer();

  if (rounded) {
    const r = Math.round(size * TILE_RADIUS_RATIO);
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`
    );
    return sharp(flat)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  // Opaque outputs: the tile is already solid, so the alpha channel carries nothing.
  // Drop it — iOS paints any transparency in an apple-touch-icon black.
  return sharp(flat).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/** Wrap PNG buffers in an ICO container (PNG-encoded entries, supported everywhere). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);     // width
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    dir.writeUInt8(0, o + 2);                      // palette
    dir.writeUInt8(0, o + 3);                      // reserved
    dir.writeUInt16LE(1, o + 4);                   // colour planes
    dir.writeUInt16LE(32, o + 6);                  // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

async function main() {
  const art = await loadArtwork();
  const meta = await sharp(art).metadata();
  await fs.mkdir(OUT_DIR, { recursive: true });

  const outputs = [
    ['icon-192.png', await compose(art, 192, ANY_LOGO_RATIO, { rounded: true })],
    ['icon-512.png', await compose(art, 512, ANY_LOGO_RATIO, { rounded: true })],
    ['icon-maskable-192.png', await compose(art, 192, MASKABLE_LOGO_RATIO)],
    ['icon-maskable-512.png', await compose(art, 512, MASKABLE_LOGO_RATIO)],
    ['apple-touch-icon.png', await compose(art, 180, APPLE_LOGO_RATIO)],
  ];
  for (const [name, buf] of outputs) {
    await fs.writeFile(path.join(OUT_DIR, name), buf);
    console.log(`public/icons/${name}  ${buf.length} bytes`);
  }

  // Favicon: rainbow mark only, on the rounded tile.
  const mark = await sharp(art)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * MARK_HEIGHT_RATIO) })
    .png()
    .toBuffer();
  const ico = buildIco(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        png: await compose(mark, size, FAVICON_MARK_RATIO, { rounded: true }),
      }))
    )
  );
  await fs.writeFile(FAVICON, ico);
  console.log(`src/app/favicon.ico  ${ico.length} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
