import { LevelLayout } from "./schema.js";
import { checkOverlaps, OverlapFinding, OverlapOptions } from "./validators/overlap.js";
import { checkBounds, BoundsFinding } from "./validators/bounds.js";
import { checkReachability, ReachabilityFinding } from "./validators/reachability.js";

export interface ValidationReport {
  ok: boolean;
  overlaps: OverlapFinding[];
  outOfZone: BoundsFinding[];
  unreachable: ReachabilityFinding[];
  summary: string;
}

export interface ValidateOptions {
  overlap?: OverlapOptions;
  /** Skip the reachability pass — useful for a layout with no `floor`-tagged placements yet
   *  (still being authored) without that reading as "zero surfaces, zero problems". */
  checkReachability?: boolean;
}

/**
 * The single gate every layout passes through before a builder is allowed to touch it.
 *
 * `ok: false` is the whole point of this project existing: it means the STRUCTURED, MACHINE-
 * CHECKABLE representation of the level failed a test that has nothing to do with whether the
 * model "felt confident" about the coordinates it wrote. A caller (an MCP tool, a CLI, a CI step)
 * should refuse to build, or hand the report back to the model to fix, rather than ever building
 * a layout this function rejected.
 */
export function validateLayout(layout: LevelLayout, options: ValidateOptions = {}): ValidationReport {
  const shapeErrors = validateLayoutShape(layout);
  if (shapeErrors.length > 0) {
    return {
      ok: false,
      overlaps: [],
      outOfZone: [],
      unreachable: [],
      summary: `Layout is structurally invalid before any geometry check could run:\n` +
               shapeErrors.map((e) => `  - ${e}`).join("\n"),
    };
  }

  const overlaps = checkOverlaps(layout, options.overlap);
  const outOfZone = checkBounds(layout);
  const reachability = options.checkReachability === false
    ? { totalSurfaces: 0, reachableSurfaces: 0, unreachable: [] }
    : checkReachability(layout);

  const ok = overlaps.length === 0 && outOfZone.length === 0 && reachability.unreachable.length === 0;

  const lines: string[] = [];
  lines.push(ok ? `Layout "${layout.id}" is clean.` : `Layout "${layout.id}" FAILED validation.`);
  if (overlaps.length > 0) {
    lines.push(`${overlaps.length} interpenetrating pair(s):`);
    for (const o of overlaps.slice(0, 20)) {
      lines.push(`  OVERLAP ${o.aName} (${o.a})  x  ${o.bName} (${o.b})  ` +
                 `@ (${o.centre.x.toFixed(1)}, ${o.centre.y.toFixed(1)}, ${o.centre.z.toFixed(1)})  ` +
                 `(${(o.volumeRatio * 100).toFixed(0)}% of the smaller volume)`);
    }
    if (overlaps.length > 20) lines.push(`  ...and ${overlaps.length - 20} more.`);
  }
  if (outOfZone.length > 0) {
    lines.push(`${outOfZone.length} placement(s) drifted outside their zone:`);
    for (const b of outOfZone.slice(0, 20)) {
      lines.push(`  DRIFT ${b.placementName} (${b.placementId}) is outside zone "${b.zoneId}".`);
    }
    if (outOfZone.length > 20) lines.push(`  ...and ${outOfZone.length - 20} more.`);
  }
  if (reachability.unreachable.length > 0) {
    lines.push(`${reachability.unreachable.length}/${reachability.totalSurfaces} floor(s) unreachable from spawn:`);
    for (const u of reachability.unreachable.slice(0, 20)) {
      lines.push(`  UNREACHABLE ${u.placementName} (${u.placementId}) @ ` +
                 `(${u.position.x.toFixed(1)}, ${u.position.y.toFixed(1)}, ${u.position.z.toFixed(1)})`);
    }
    if (reachability.unreachable.length > 20) lines.push(`  ...and ${reachability.unreachable.length - 20} more.`);
  }

  return { ok, overlaps, outOfZone, unreachable: reachability.unreachable, summary: lines.join("\n") };
}

/** Structural sanity — dangling references, duplicate ids — checked before any geometry math runs. */
function validateLayoutShape(layout: LevelLayout): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const p of layout.placements) {
    if (ids.has(p.id)) errors.push(`Duplicate placement id "${p.id}".`);
    ids.add(p.id);
  }

  for (const zone of layout.zones) {
    for (const pid of zone.placementIds) {
      if (!ids.has(pid)) errors.push(`Zone "${zone.id}" references unknown placement id "${pid}".`);
    }
  }

  for (const p of layout.placements) {
    if (p.groupId != null) {
      const groupMate = layout.placements.find((o) => o.id !== p.id && o.groupId === p.groupId);
      // Not an error — a group of one is fine — but worth nothing further here. Kept as a hook
      // for future stricter modes (e.g. "every groupId must have >=2 members").
      void groupMate;
    }
  }

  return errors;
}
