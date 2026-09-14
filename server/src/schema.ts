/**
 * The layout schema every tool in this project speaks.
 *
 * WHY A SCHEMA AT ALL: the failure this project exists to prevent is an LLM writing placement
 * *code* directly — C#, imperative, position math computed once and trusted forever. That was
 * the Puntsy incident: a hand-authored world builder script placed ~130 objects from arithmetic
 * that looked reasonable line-by-line and was wrong in aggregate (a solid landmark collider
 * swallowing an entire dungeon, terrain noise sprawling past its zone, enemies embedded in the
 * ground). Nothing checked the RESULT until a human said "this looks broken."
 *
 * The fix is architectural, not attitudinal: the model never writes placement code. It writes
 * DATA — a LevelLayout, plain JSON, against this schema — and that data is validated by
 * deterministic geometry math (see validators/) before a single GameObject exists. A builder
 * only ever consumes an already-validated layout. Bad output becomes a rejected JSON document
 * instead of a scene full of interpenetrating geometry nobody checked.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  /** World-space centre of the box. */
  center: Vec3;
  /** Full extents (width, height, depth) — NOT half-extents. */
  size: Vec3;
}

export type PlacementKind =
  | "block" // authored solid geometry (a wall, a floor slab, a stair block)
  | "prop" // a placed prefab/asset reference — decoration, a hazard prop, a platform
  | "enemy"
  | "collectible"
  | "hazard"
  | "checkpoint";

export interface Placement {
  /** Unique within the layout. Used by validators to name findings unambiguously. */
  id: string;
  kind: PlacementKind;
  /** Human label — shows up in validator reports, doesn't have to be unique. */
  name: string;
  position: Vec3;
  /** Yaw only, degrees. Most placement in a 3D platformer is yaw-only; full quaternions are a
   *  non-goal for v0.1 — pitch/roll placement (ramps, tilted wreckage) needs its own AABB anyway
   *  since axis-aligned bounds stop being a good approximation once an object is tilted. */
  rotationY?: number;
  /** Bounding box size used for ALL validation (overlap, bounds, reachability). This does not
   *  have to be the object's exact visual mesh size — a slightly generous box is the safe
   *  direction to round, since validation exists to catch problems, not to be a perfect renderer. */
  size: Vec3;
  /** For prop/enemy/collectible: what the builder should instantiate. Opaque to the validator —
   *  a path, a catalog id, whatever the target Unity project's own asset convention is. */
  prefabRef?: string;
  /** Default true. false = a trigger volume (hazard, pickup, portal) — excluded from the solid
   *  overlap check, because a hazard volume overlapping a floor is how hazards WORK, not a bug. */
  solid?: boolean;
  /** Free-form tags read by specific validators — e.g. "floor" marks a placement as walkable
   *  surface for the reachability check and the flush-mount overlap exception. */
  tags?: string[];
  /** Placements sharing a groupId are treated as ONE instance — siblings are expected to touch
   *  (a statue's paws against its body, an enemy's hurtbox against its own root). Only overlaps
   *  between DIFFERENT groups are reported. Placements with no groupId are their own group. */
  groupId?: string;
}

export interface Zone {
  id: string;
  /** The footprint this zone is AUTHORED to stay inside. Placements belonging to this zone that
   *  drift outside these bounds are exactly the "dune terrain sprawled into the sphinx ruins"
   *  failure class — organic/noise-based geometry generation is the usual cause. */
  bounds: AABB;
  /** Placement ids belonging to this zone. A placement not listed in any zone is unchecked by
   *  the bounds validator (useful for world-spanning objects like a shared ground plane). */
  placementIds: string[];
}

export interface MovementProfile {
  /** Positive magnitude (m/s^2), even though gravity points down. */
  gravity: number;
  jumpHeight: number;
  runSpeed: number;
  /** The largest rise a single "step" (stair tread, ledge) may ask the player to climb without
   *  a jump. Used by the reachability check to tell a climbable stair from a wall. */
  maxRisePerStep: number;
  /** How many air jumps/dashes the reachability check should assume the player always has
   *  available (a double/triple-jump game should pass its real number). Default 1. */
  jumpsAvailable?: number;
}

export interface LevelLayout {
  id: string;
  zones: Zone[];
  placements: Placement[];
  spawn: Vec3;
  movement: MovementProfile;
}

export function emptyLayout(id: string, movement: MovementProfile, spawn: Vec3): LevelLayout {
  return { id, zones: [], placements: [], spawn, movement };
}
