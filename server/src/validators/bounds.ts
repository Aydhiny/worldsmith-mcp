import { LevelLayout } from "../schema.js";
import { contains, placementBounds } from "../geometry.js";

export interface BoundsFinding {
  type: "out-of-zone";
  placementId: string;
  placementName: string;
  zoneId: string;
}

/**
 * Finds placements that have drifted outside the zone that claims them.
 *
 * THE FAILURE THIS CATCHES: organic/noise-based terrain generation (Perlin blobs, cellular
 * automata, anything with a randomised radius) reliably extends further than its nominal radius
 * suggests — on the real world this tool is descended from, a dune field authored at "radius 78,
 * noise amplitude 0.4" actually reached ~1.5x that far once the noise bands were accounted for,
 * sprawling straight through the neighbouring zone's statue and floor. The generator's own
 * intent ("this zone spans roughly here") is not the same fact as "this is where the geometry
 * actually ended up", and only the second one is checkable.
 *
 * Deliberately not a hard rejection by itself in the top-level `validate` orchestrator's default
 * severity — a few centimetres of overhang from a rounded corner is usually fine. It is a
 * REPORTED finding so a human or a follow-up generation pass can decide, the same way a linter
 * warns rather than silently fixing.
 */
export function checkBounds(layout: LevelLayout): BoundsFinding[] {
  const findings: BoundsFinding[] = [];
  const byId = new Map(layout.placements.map((p) => [p.id, p]));

  for (const zone of layout.zones) {
    for (const placementId of zone.placementIds) {
      const placement = byId.get(placementId);
      if (placement == null) continue; // dangling id — caught by validateLayoutShape, not here

      const box = placementBounds(placement);
      if (!contains(zone.bounds, box)) {
        findings.push({
          type: "out-of-zone",
          placementId: placement.id,
          placementName: placement.name,
          zoneId: zone.id,
        });
      }
    }
  }

  return findings;
}
