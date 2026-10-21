import type { MetadataRoute } from 'next';
import { createManifest } from '@pos/core/shell/metadata';
import { brand } from '@/edition/brand';

// Served by Next at /manifest.webmanifest. Shape + icons live in core.
export default function manifest(): MetadataRoute.Manifest {
  return createManifest(brand);
}
