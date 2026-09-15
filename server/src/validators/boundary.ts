import { LevelLayout, Placement } from "../schema.js";
import { toMinMax } from "../geometry.js";

export interface BoundaryGapFinding {
  type: "open-boundary-gap";
  zoneId: string;
  side: "min" | "max";
  /** The band centre (along the zone's long axis) that has no flanking geometry near it. */
  axis: "x" | "z";
  bandCentre: number;
}

export interface BoundaryOptions {
  /** How far outward from the zone's edge, along the short axis, flanking geometry is allowed to
   *  start and still count as "closing" that edge. Default 40 world units. */
  maxGapMargin?: number;
  /** How wide a band to sample along the zone's long axis. Smaller = finer-grained, slower.
   *  Default 20 world units. */
  bandSize?: number;
}

/**
 * THE FAILURE THIS CATCHES: a zone whose FLOOR is fully validated (no overlaps, nothing out of
 * bounds, everything reachable) can still read as nothing at all once a camera pulls back, because
 * nothing was ever asked to flank it. On the world this check is descended from, a valley's bank
 * ridges were authored for the first two zones of a five-zone route and then just... stopped —
 * every per-zone check passed, the overlap audit was clean, and the world still looked like a
 * handful of rectangular floor pads floating in an empty void the moment you looked at it from
 * above or from any distance, because open space with nothing bounding it reads as "unfinished",
 * not as "intentionally open". The other validators in this project ask "is the geometry that
 * exists correct?" — this one is the first to ask "is there enough of it in the first place?"
 *
 * A zone is flagged when its long axis (the longer of bounds.size.x/.z) has a BAND with no solid,
 * "boundary"-tagged placement within `maxGapMargin` of one of its short-axis edges. Tag any
 * flanking scenery — cliff walls, mountain ridges, a canyon lip, a treeline — with "boundary" to
 * be counted; undecorated background dressing with no such tag is invisible to this check on
 * purpose, so a generator can't satisfy it by accident with unrelated clutter.
 *
 * Deliberately NOT part of the hard-fail `ok` gate in validate.ts's default mode — an interior
 * room legitimately has no "flanking ridge" concept, and a zone that is meant to open onto a
 * vista (a cliff edge, a beach) should not be forced to wall itself in. Call this explicitly once
 * a layout's outdoor zones are meant to read as one continuous place rather than isolated pads.
 */
export function checkBoundaryContinuity(
  layout: LevelLayout,
  options: BoundaryOptions = {},
): BoundaryGapFinding[] {
  const maxGapMargin = options.maxGapMargin ?? 40;
  const bandSize = options.bandSize ?? 20;
  const findings: BoundaryGapFinding[] = [];

  const boundaryPlacements = layout.placements.filter(
    (p) => p.solid !== false && (p.tags ?? []).includes("boundary"),
  );

  for (const zone of layout.zones) {
    const m = toMinMax(zone.bounds);
    const longAxis: "x" | "z" = zone.bounds.size.x >= zone.bounds.size.z ? "x" : "z";
    const shortAxis: "x" | "z" = longAxis === "x" ? "z" : "x";
    const longMin = longAxis === "x" ? m.min.x : m.min.z;
    const longMax = longAxis === "x" ? m.max.x : m.max.z;
    const shortMin = shortAxis === "x" ? m.min.x : m.min.z;
    const shortMax = shortAxis === "x" ? m.max.x : m.max.z;

    for (let bandStart = longMin; bandStart < longMax; bandStart += bandSize) {
      const bandEnd = Math.min(bandStart + bandSize, longMax);
      const bandCentre = (bandStart + bandEnd) / 2;

      for (const side of ["min", "max"] as const) {
        const edge = side === "min" ? shortMin : shortMax;
        const closed = boundaryPlacements.some((p) => {
          if (!bandOverlapsPlacement(p, longAxis, bandStart, bandEnd)) return false;
          const pMin = shortAxis === "x" ? p.position.x - p.size.x / 2 : p.position.z - p.size.z / 2;
          const pMax = shortAxis === "x" ? p.position.x + p.size.x / 2 : p.position.z + p.size.z / 2;
          const distanceOutward = side === "min" ? edge - pMax : pMin - edge;
          // The placement must sit OUTSIDE the zone edge (a ridge inside the walkable floor is a
          // different bug, not a closed boundary) and within the allowed margin of it.
          return distanceOutward >= -0.01 && distanceOutward <= maxGapMargin;
        });

        if (!closed) {
          findings.push({ type: "open-boundary-gap", zoneId: zone.id, side, axis: shortAxis, bandCentre });
        }
      }
    }
  }

  return findings;
}

function bandOverlapsPlacement(
  p: Placement,
  longAxis: "x" | "z",
  bandStart: number,
  bandEnd: number,
): boolean {
  const centre = longAxis === "x" ? p.position.x : p.position.z;
  const half = (longAxis === "x" ? p.size.x : p.size.z) / 2;
  return centre + half >= bandStart && centre - half <= bandEnd;
}
