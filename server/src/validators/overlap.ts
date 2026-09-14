import { LevelLayout, Placement, Vec3 } from "../schema.js";
import { intersection, intersects, placementBounds, volume } from "../geometry.js";

export interface OverlapFinding {
  type: "overlap";
  a: string;
  b: string;
  aName: string;
  bName: string;
  centre: Vec3;
  volumeRatio: number;
}

export interface OverlapOptions {
  /** Two boxes must share at least this fraction of the smaller one's volume to be reported.
   *  Below this is treated as incidental edge-touching (a wall meeting a floor), not a bug.
   *  This is the exact threshold and exact reasoning OverlapAudit.cs used in production against
   *  a real generated Unity world — it is what separated "wall touches floor" (~0%, not
   *  reported) from "corridor buried inside a landmark's solid collider" (50-100%, reported). */
  volumeRatioThreshold?: number;
}

const DEFAULTS: Required<OverlapOptions> = { volumeRatioThreshold: 0.08 };

/**
 * Finds solid placements that interpenetrate.
 *
 * THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE PUNTSY INCIDENT BEFORE A SINGLE OBJECT EXISTED IN
 * UNITY. Run against the plain JSON layout, it needs no engine, no scene, no build step — it is
 * pure geometry, which means it can gate generation at the point the model still has a chance to
 * be asked to fix it, rather than after a human has to notice from a screenshot.
 *
 * Two design choices, both learned the hard way on a real generated world:
 *
 *  - non-solid placements (hazard volumes, pickups, portals — `solid: false`) are excluded
 *    entirely. A hazard overlapping the floor it sits on is how hazards work, not a bug.
 *  - placements sharing a `groupId` are excluded from each other. An enemy's hurtbox is expected
 *    to overlap its own root collider; a statue's paws are expected to touch its own body. Only
 *    cross-group overlaps — different, unrelated placed objects occupying the same volume — are
 *    the failure this function exists to find.
 */
export function checkOverlaps(layout: LevelLayout, options: OverlapOptions = {}): OverlapFinding[] {
  const opts = { ...DEFAULTS, ...options };
  const solids = layout.placements.filter((p) => p.solid !== false);
  const findings: OverlapFinding[] = [];

  for (let i = 0; i < solids.length; i++) {
    const a = solids[i];
    const boundsA = placementBounds(a);
    const volA = volume(boundsA.size);
    if (volA < 1e-4) continue;

    for (let j = i + 1; j < solids.length; j++) {
      const b = solids[j];
      if (sameGroup(a, b)) continue;

      const boundsB = placementBounds(b);
      if (!intersects(boundsA, boundsB)) continue;

      const volB = volume(boundsB.size);
      const overlap = intersection(boundsA, boundsB);
      const overlapVol = volume(overlap.size);
      const ratio = overlapVol / Math.min(volA, volB);

      if (ratio >= opts.volumeRatioThreshold) {
        findings.push({
          type: "overlap",
          a: a.id,
          b: b.id,
          aName: a.name,
          bName: b.name,
          centre: overlap.center,
          volumeRatio: ratio,
        });
      }
    }
  }

  return findings.sort((x, y) => y.volumeRatio - x.volumeRatio);
}

function sameGroup(a: Placement, b: Placement): boolean {
  if (a.groupId == null || b.groupId == null) return false;
  return a.groupId === b.groupId;
}
