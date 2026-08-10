import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const explicit = process.env.YUKU_TSRX_BINDING;

if (!explicit) {
  throw new Error("Set YUKU_TSRX_BINDING to the local yuku-tsrx.node artifact.");
}

export default require(explicit);
