import { createNextConfig } from "@pos/core/next-config.mjs";

// Security headers, image allowlist and monorepo settings are shared by every
// edition — see packages/pos-core/next-config.mjs.
export default createNextConfig();
