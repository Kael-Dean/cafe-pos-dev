'use client';

import { PosApp } from '@pos/core/shell/pos-app';
import { edition } from '@/edition';

// The whole POS is one client page; the edition decides which screens it has.
export default function Page() {
  return <PosApp edition={edition} />;
}
