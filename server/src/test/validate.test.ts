import { test } from "node:test";
import assert from "node:assert/strict";
import { LevelLayout, Placement } from "../schema.js";
import { checkOverlaps } from "../validators/overlap.js";
import { checkBounds } from "../validators/bounds.js";
import { checkReachability, maxHorizontalReach } from "../validators/reachability.js";
import { validateLayout } from "../validate.js";
import { suggestOverlapRepairs, applySuggestion } from "../validators/repair.js";
import { checkBoundaryContinuity } from "../validators/boundary.js";

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

// --- repair suggestions --------------------------------------------------------------------

test("repair: a prop embedded in a floor gets a suggestion that actually clears it", () => {
  const floor = place("floor", 0, 0, 0, 20, 1, 20);
  const prop = place("prop", 0, 0.2, 0, 3, 1, 3); // mostly buried in the floor

  const layout: LevelLayout = { id: "t", zones: [], placements: [floor, prop], spawn: { x: 0, y: 0, z: 0 }, movement };
  const findings = checkOverlaps(layout);
  assert.equal(findings.length, 1);

  const suggestions = suggestOverlapRepairs(layout, findings);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].placementId, "prop"); // never moves the "block" geometry

  const repaired = applySuggestion(layout, suggestions[0]);
  const findingsAfter = checkOverlaps(repaired);
  assert.equal(findingsAfter.length, 0, "the suggested delta should fully clear the overlap");
});

// --- boundary continuity: the "reads as a void" bug ---------------------------------------

test("boundary: a zone flanked along its whole length reports no gaps", () => {
  const floor = place("floor", 0, 0, 0, 40, 1, 100);
  const ridges: Placement[] = [];
  for (let z = -50; z <= 50; z += 20) {
    ridges.push(place(`ridgeL${z}`, -35, 10, z, 10, 20, 15, { tags: ["boundary"] }));
    ridges.push(place(`ridgeR${z}`, 35, 10, z, 10, 20, 15, { tags: ["boundary"] }));
  }
  const layout: LevelLayout = {
    id: "t",
    zones: [{ id: "valley", bounds: { center: { x: 0, y: 0, z: 0 }, size: { x: 40, y: 20, z: 100 } }, placementIds: [] }],
    placements: [floor, ...ridges],
    spawn: { x: 0, y: 0, z: 0 },
    movement,
  };
  const findings = checkBoundaryContinuity(layout);
  assert.equal(findings.length, 0);
});

test("boundary: ridges that stop halfway leave the back half of the zone flagged open", () => {
  // The actual shape of the bug: bank ridges authored for the front of a valley and never
  // extended to the back — every other check on this layout would still pass clean.
  const floor = place("floor", 0, 0, 0, 40, 1, 100);
  const ridges: Placement[] = [];
  for (let z = -50; z <= 0; z += 20) {
    ridges.push(place(`ridgeL${z}`, -35, 10, z, 10, 20, 15, { tags: ["boundary"] }));
    ridges.push(place(`ridgeR${z}`, 35, 10, z, 10, 20, 15, { tags: ["boundary"] }));
  }
  const layout: LevelLayout = {
    id: "t",
    zones: [{ id: "valley", bounds: { center: { x: 0, y: 0, z: 0 }, size: { x: 40, y: 20, z: 100 } }, placementIds: [] }],
    placements: [floor, ...ridges],
    spawn: { x: 0, y: 0, z: 0 },
    movement,
  };
  const findings = checkBoundaryContinuity(layout);
  assert.ok(findings.length > 0);
  assert.ok(findings.every((f) => f.bandCentre > 0), "only the un-ridged back half should be flagged");
});

test("boundary: unrelated clutter with no \"boundary\" tag does not satisfy the check", () => {
  const floor = place("floor", 0, 0, 0, 40, 1, 100);
  const clutter = place("rock", -36, 1, 0, 4, 2, 4); // right next to the edge, but untagged
  const layout: LevelLayout = {
    id: "t",
    zones: [{ id: "valley", bounds: { center: { x: 0, y: 0, z: 0 }, size: { x: 40, y: 20, z: 100 } }, placementIds: [] }],
    placements: [floor, clutter],
    spawn: { x: 0, y: 0, z: 0 },
    movement,
  };
  const findings = checkBoundaryContinuity(layout);
  assert.ok(findings.length > 0, "untagged geometry must not accidentally close a boundary gap");
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
