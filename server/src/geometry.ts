import { AABB, Placement, Vec3 } from "./schema.js";

export interface MinMax {
  min: Vec3;
  max: Vec3;
}

export function toMinMax(box: AABB): MinMax {
  const hx = box.size.x / 2, hy = box.size.y / 2, hz = box.size.z / 2;
  return {
    min: { x: box.center.x - hx, y: box.center.y - hy, z: box.center.z - hz },
    max: { x: box.center.x + hx, y: box.center.y + hy, z: box.center.z + hz },
  };
}

/**
 * A placement's bounds. NOTE: rotationY is deliberately ignored here (see schema.ts's comment on
 * Placement.rotationY) — an axis-aligned box around a yawed object is a conservative over-approx
 * for anything close to square, and a genuinely wrong approximation for a long thin rotated
 * object. v0.1's honest limitation: pass a size that already accounts for worst-case rotation
 * (e.g. the diagonal) for anything long and rotated, or extend this to true OBB overlap later.
 */
export function placementBounds(p: Placement): AABB {
  return { center: p.position, size: p.size };
}

export function volume(size: Vec3): number {
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z);
}

export function intersects(a: AABB, b: AABB): boolean {
  const ma = toMinMax(a), mb = toMinMax(b);
  return (
    ma.min.x <= mb.max.x && ma.max.x >= mb.min.x &&
    ma.min.y <= mb.max.y && ma.max.y >= mb.min.y &&
    ma.min.z <= mb.max.z && ma.max.z >= mb.min.z
  );
}

/** The overlapping region of two boxes. Only meaningful when `intersects(a, b)` is true. */
export function intersection(a: AABB, b: AABB): AABB {
  const ma = toMinMax(a), mb = toMinMax(b);
  const min: Vec3 = {
    x: Math.max(ma.min.x, mb.min.x),
    y: Math.max(ma.min.y, mb.min.y),
    z: Math.max(ma.min.z, mb.min.z),
  };
  const max: Vec3 = {
    x: Math.max(min.x, Math.min(ma.max.x, mb.max.x)),
    y: Math.max(min.y, Math.min(ma.max.y, mb.max.y)),
    z: Math.max(min.z, Math.min(ma.max.z, mb.max.z)),
  };
  return {
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

export function contains(zone: AABB, box: AABB): boolean {
  const mz = toMinMax(zone), mb = toMinMax(box);
  return (
    mb.min.x >= mz.min.x && mb.max.x <= mz.max.x &&
    mb.min.y >= mz.min.y && mb.max.y <= mz.max.y &&
    mb.min.z >= mz.min.z && mb.max.z <= mz.max.z
  );
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function topCenter(box: AABB): Vec3 {
  return { x: box.center.x, y: box.center.y + box.size.y / 2, z: box.center.z };
}
