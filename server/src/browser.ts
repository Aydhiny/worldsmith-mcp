/**
 * Browser entry point — bundled by esbuild into ui/vendor/worldsmith-core.js. Re-exports exactly
 * the pure-geometry pieces (no Node APIs, no MCP SDK, no zod) so the same validator logic that
 * gates the MCP server also runs the in-browser Layout Inspector, with no second implementation
 * to drift out of sync.
 */
export * from "./schema.js";
export * from "./geometry.js";
export * from "./validate.js";
export * from "./validators/overlap.js";
export * from "./validators/bounds.js";
export * from "./validators/reachability.js";
export * from "./validators/repair.js";
