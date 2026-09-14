#!/usr/bin/env node
import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LevelLayoutSchema } from "./schema.zod.js";

/**
 * Emits a standalone JSON Schema (draft 2020-12) for LevelLayout — usable by anything that
 * isn't this TypeScript project: an editor's JSON autocomplete, a different language's own
 * validator, a model's function-calling schema, CI linting a checked-in layout file. The zod
 * schema (schema.zod.ts) stays the single source of truth; this is just a projection of it.
 */
const jsonSchema = zodToJsonSchema(LevelLayoutSchema, {
  name: "LevelLayout",
  $refStrategy: "none",
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "..", "docs", "level-layout.schema.json");
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");

console.log(`Wrote ${outPath}`);
