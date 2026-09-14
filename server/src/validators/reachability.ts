import { LevelLayout, MovementProfile, Placement, Vec3 } from "../schema.js";
import { distance3, distanceXZ, placementBounds, topCenter } from "../geometry.js";

export interface ReachabilityFinding {
  type: "unreachable";
  placementId: string;
  placementName: string;
  position: Vec3;
}

export interface ReachabilityReport {
  totalSurfaces: number;
  reachableSurfaces: number;
  unreachable: ReachabilityFinding[];
}

/**
 * Maximum horizontal distance a jump can cover for a given height change, using real projectile
 * motion under the layout's own MovementProfile — never a flat "gap size" constant. This is the
 * single most valuable number in a jump-based platformer's level design, and the one every
 * rejected Puntsy world got wrong by eyeballing it: platforms spaced correctly on the HORIZONTAL
 * axis alone look perfect in an editor and are unreachable the moment one of them sits higher
 * than the other, because real reach collapses fast with height.
 *
 * dy = target.y - source.y (positive = climbing).
 *
 * jumpsAvailable multiplies the single-jump arc linearly — a documented v0.1 simplification.
 * Real chained multi-jumps (a weaker second/third jump, as Puntsy's own triple-jump uses) are
 * not one long arc, they are several arcs stitched together at landings, which this function
 * does not model. Treat `jumpsAvailable > 1` as "roughly how far a skilled chain can reach", not
 * a guarantee — tighten MovementProfile.jumpsAvailable to 1 for an exact single-jump reach.
 */
export function maxHorizontalReach(dy: number, movement: MovementProfile): number {
  const g = Math.abs(movement.gravity);
  const v0 = Math.sqrt(Math.max(0, 2 * g * movement.jumpHeight));
  const jumps = Math.max(1, movement.jumpsAvailable ?? 1);

  // Solve dy = v0*t - 0.5*g*t^2 for t. No real root => the jump physically cannot reach that
  // high, regardless of horizontal distance.
  const discriminant = v0 * v0 - 2 * g * dy;
  if (discriminant < 0) return 0;

  const sqrtDisc = Math.sqrt(discriminant);
  // The LARGER root: total time until the player's arc returns to height `dy` relative to the
  // start (for dy <= 0 this is "falls past that height", for dy > 0 near the apex this is the
  // full up-and-just-over-the-top arc) — the one that matches how a platformer game reads a gap.
  const t = (v0 + sqrtDisc) / g;

  return movement.runSpeed * t * jumps;
}

export function isReachable(from: Vec3, to: Vec3, movement: MovementProfile): boolean {
  const dy = to.y - from.y;
  const reach = maxHorizontalReach(dy, movement);
  return distanceXZ(from, to) <= reach;
}

/**
 * Flood-fills from spawn across every placement tagged "floor", using real jump-arc reachability
 * as the only edge test, and reports what the flood never touched.
 *
 * SAMPLES THE LAYOUT'S OWN CLAIMED SURFACES, not a re-derivation of the generator's intent — the
 * input is exactly the set of placements the layout itself marked walkable (`tags: ["floor"]`),
 * so this checks "are the floors I said exist actually connected", the direct generalisation of
 * ReachabilityAudit.cs, minus that tool's need to physically raycast a live Unity scene (which
 * only exists after a build). Running this on plain JSON means a layout can be rejected before a
 * single GameObject is created.
 */
export function checkReachability(layout: LevelLayout): ReachabilityReport {
  const floors = layout.placements.filter((p) => (p.tags ?? []).includes("floor"));
  const surfaces = floors.map((p) => ({ placement: p, top: topCenter(placementBounds(p)) }));

  if (surfaces.length === 0) {
    return { totalSurfaces: 0, reachableSurfaces: 0, unreachable: [] };
  }

  let seedIndex = 0;
  let best = Infinity;
  for (let i = 0; i < surfaces.length; i++) {
    const d = distance3(surfaces[i].top, layout.spawn);
    if (d < best) { best = d; seedIndex = i; }
  }

  const reached = new Array(surfaces.length).fill(false);
  reached[seedIndex] = true;
  const queue: number[] = [seedIndex];

  while (queue.length > 0) {
    const ai = queue.shift()!;
    const a = surfaces[ai].top;

    for (let bi = 0; bi < surfaces.length; bi++) {
      if (reached[bi]) continue;
      if (!isReachable(a, surfaces[bi].top, layout.movement)) continue;
      reached[bi] = true;
      queue.push(bi);
    }
  }

  const unreachable: ReachabilityFinding[] = [];
  let reachableCount = 0;

  for (let i = 0; i < surfaces.length; i++) {
    if (reached[i]) { reachableCount++; continue; }
    unreachable.push({
      type: "unreachable",
      placementId: surfaces[i].placement.id,
      placementName: surfaces[i].placement.name,
      position: surfaces[i].top,
    });
  }

  return { totalSurfaces: surfaces.length, reachableSurfaces: reachableCount, unreachable };
}
