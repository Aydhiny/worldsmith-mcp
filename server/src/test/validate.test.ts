import { test } from "node:test";
import assert from "node:assert/strict";
import { LevelLayout, Placement } from "../schema.js";
import { checkOverlaps } from "../validators/overlap.js";
import { checkBounds } from "../validators/bounds.js";
import { checkReachability, maxHorizontalReach } from "../validators/reachability.js";
import { validateLayout } from "../validate.js";

const movement = { gravity: 20, jumpHeight: 4, runSpeed: 8, maxRisePerStep: 2.8 };

function place(id: string, x: number, y: number, z: number, sx: number, sy: number, sz: number,
               extra: Partial<Placement> = {}): Placement {
  return {
    id, kind: "block", name: id,
    position: { x, y, z }, size: { x: sx, y: sy, z: sz },
    ...extra,
  };
}

// --- overlap: the actual bug that shipped -------------------------------------------------

test("overlap: a solid landmark swallowing a corridor is caught (the Puntsy incident)", () => {
  // A 60-radius "landmark" cone approximated as a big box, and a small corridor block sitting
  // entirely inside its footprint — this is exactly the shape of bug #1 from the case study:
  // a decorative backdrop object that had real collision and buried the walkable geometry
  // built at the same coordinates underneath it.
  const landmark = place("landmark", 0, 20, 300, 120, 80, 120);
  const corridor = place("corridor", 0, 5, 285, 14, 9, 30);

  const findings = checkOverlaps({ id: "t", zones: [], placements: [landmark, corridor], spawn: { x: 0, y: 0, z: 0 }, movement });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].volumeRatio, 1); // corridor is FULLY inside the landmark
});

test("overlap: a wall merely touching a floor is not reported", () => {
  // Floor top at y=0.5 (centre 0, height 1), wall bottom at y=0.5 (centre 5, height 9) — they
  // share a face, not a volume.
  const floor = place("floor", 0, 0, 0, 20, 1, 20);
  const wall = place("wall", 0, 5, 10, 1, 9, 20);

  const findings = checkOverlaps({ id: "t", zones: [], placements: [floor, wall], spawn: { x: 0, y: 0, z: 0 }, movement });
  assert.equal(findings.length, 0);
});

test("overlap: siblings sharing a groupId are never reported against each other", () => {
  const body = place("body", 0, 5, 0, 20, 10, 40, { groupId: "statue" });
  const paw = place("paw", 0, 2, -18, 10, 5, 10, { groupId: "statue" });

  const findings = checkOverlaps({ id: "t", zones: [], placements: [body, paw], spawn: { x: 0, y: 0, z: 0 }, movement });
  assert.equal(findings.length, 0);
});

test("overlap: a hazard volume (solid: false) never counts, even fully inside a floor", () => {
  const floor = place("floor", 0, 0, 0, 20, 1, 20);
  const hazard = place("hazard", 0, 0, 0, 5, 1, 5, { solid: false });

  const findings = checkOverlaps({ id: "t", zones: [], placements: [floor, hazard], spawn: { x: 0, y: 0, z: 0 }, movement });
  assert.equal(findings.length, 0);
});

// --- zone bounds: the dune-sprawl bug -----------------------------------------------------

test("bounds: a placement that sprawled past its zone is caught", () => {
  const sprawled = place("dune_edge", 0, 0, 105, 30, 4, 30); // extends to z=90..120
  const layout: LevelLayout = {
    id: "t",
    zones: [{ id: "dune_approach", bounds: { center: { x: 0, y: 0, z: 40 }, size: { x: 100, y: 20, z: 100 } }, placementIds: ["dune_edge"] }],
    placements: [sprawled],
    spawn: { x: 0, y: 0, z: 0 },
    movement,
  };
  const findings = checkBounds(layout);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].placementId, "dune_edge");
});

// --- reachability -----------------------------------------------------------------------

test("reachability: max horizontal reach shrinks as height difference grows", () => {
  const flat = maxHorizontalReach(0, movement);
  const climb = maxHorizontalReach(3, movement);
  assert.ok(flat > climb, `flat reach (${flat}) should exceed a 3m climb's reach (${climb})`);
});

test("reachability: an out-of-range platform is flagged unreachable", () => {
  const near = place("near", 0, 0, 5, 4, 1, 4, { tags: ["floor"] });
  const far = place("far", 0, 0, 500, 4, 1, 4, { tags: ["floor"] }); // absurdly far, unreachable
  const layout: LevelLayout = {
    id: "t", zones: [], placements: [near, far], spawn: { x: 0, y: 1, z: 0 }, movement,
  };
  const report = checkReachability(layout);
  assert.equal(report.unreachable.length, 1);
  assert.equal(report.unreachable[0].placementId, "far");
});

// --- the orchestrator ----------------------------------------------------------------------

test("validateLayout: a clean layout passes with ok:true", () => {
  const floor = place("floor", 0, 0, 0, 20, 1, 20, { tags: ["floor"] });
  const layout: LevelLayout = { id: "t", zones: [], placements: [floor], spawn: { x: 0, y: 1, z: 0 }, movement };
  const report = validateLayout(layout);
  assert.equal(report.ok, true);
});

test("validateLayout: a structurally broken layout (dangling zone reference) fails fast", () => {
  const layout: LevelLayout = {
    id: "t",
    zones: [{ id: "z", bounds: { center: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }, placementIds: ["ghost"] }],
    placements: [],
    spawn: { x: 0, y: 0, z: 0 },
    movement,
  };
  const report = validateLayout(layout);
  assert.equal(report.ok, false);
  assert.match(report.summary, /unknown placement id/);
});
