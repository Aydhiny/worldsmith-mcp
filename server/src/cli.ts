#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { LevelLayoutSchema } from "./schema.zod.js";
import { validateLayout } from "./validate.js";
import { checkOverlaps } from "./validators/overlap.js";
import { suggestOverlapRepairs } from "./validators/repair.js";

/**
 * A CLI for the same validators the MCP server exposes — so a layout can be checked in CI, or by
 * hand, without an MCP client at all. `worldsmith validate` is the one to wire into a build
 * pipeline: it exits non-zero on any finding, exactly like a linter.
 */

const [, , command, filePath] = process.argv;

function loadLayout(path: string | undefined) {
  if (!path) {
    console.error("Usage: worldsmith <validate|repair> <layout.json>");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const parsed = LevelLayoutSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`"${path}" is not a valid LevelLayout:`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(2);
  }
  return parsed.data;
}

switch (command) {
  case "validate": {
    const layout = loadLayout(filePath);
    const report = validateLayout(layout);
    console.log(report.summary);
    process.exit(report.ok ? 0 : 1);
    break;
  }

  case "repair": {
    const layout = loadLayout(filePath);
    const findings = checkOverlaps(layout);
    if (findings.length === 0) {
      console.log("No overlaps — nothing to repair.");
      break;
    }
    const suggestions = suggestOverlapRepairs(layout, findings);
    for (const s of suggestions) {
      console.log(`${s.placementName} (${s.placementId}): move ${s.axis} by ${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(2)}m — ${s.reason}`);
    }
    break;
  }

  default:
    console.error("Usage: worldsmith <validate|repair> <layout.json>");
    process.exit(2);
}
