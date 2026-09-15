#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LevelLayoutSchema } from "./schema.zod.js";
import { LevelLayout, emptyLayout, MovementProfile } from "./schema.js";
import { validateLayout } from "./validate.js";
import { checkOverlaps } from "./validators/overlap.js";
import { checkBounds } from "./validators/bounds.js";
import { checkReachability, maxHorizontalReach } from "./validators/reachability.js";
import { suggestOverlapRepairs } from "./validators/repair.js";
import { checkBoundaryContinuity } from "./validators/boundary.js";
import { checkPlacementVariety } from "./validators/variety.js";

const server = new McpServer({
  name: "worldsmith",
  version: "0.1.0",
});

/**
 * THE core tool. Everything else here is a convenience wrapper around the same validators this
 * calls internally — this is the one a build pipeline should actually gate on.
 */
server.tool(
  "validate_layout",
  "Validates a LevelLayout (plain JSON — zones, placements, spawn, movement profile) against " +
    "three deterministic geometry checks: solid-object overlap, zone-bounds drift, and jump-arc " +
    "reachability from spawn. Returns ok:false and a human-readable report the moment ANY check " +
    "fails. A builder (Unity or otherwise) must never instantiate a layout this tool rejected. " +
    "Runs on pure JSON — no Unity connection needed, so a layout can be checked before an editor " +
    "is even open.",
  {
    layout: LevelLayoutSchema,
    volumeRatioThreshold: z.number().min(0).max(1).optional()
      .describe("Fraction of the smaller object's volume two solids must share to count as an " +
                "overlap (default 0.08). Lower = stricter."),
    checkReachability: z.boolean().optional()
      .describe("Set false to skip the reachability pass (e.g. while a layout is still being " +
                "authored and has no floor-tagged placements yet)."),
  },
  async ({ layout, volumeRatioThreshold, checkReachability }) => {
    const report = validateLayout(layout as LevelLayout, {
      overlap: volumeRatioThreshold != null ? { volumeRatioThreshold } : undefined,
      checkReachability,
    });

    return {
      content: [{ type: "text", text: report.summary }],
      isError: !report.ok,
      structuredContent: report as unknown as Record<string, unknown>,
    };
  },
);

server.tool(
  "check_overlaps",
  "Runs ONLY the solid-overlap check against a LevelLayout and returns every interpenetrating " +
    "pair, ranked worst-first. Use validate_layout for the full gate; use this when you already " +
    "know overlap is the thing you're iterating on.",
  {
    layout: LevelLayoutSchema,
    volumeRatioThreshold: z.number().min(0).max(1).optional(),
  },
  async ({ layout, volumeRatioThreshold }) => {
    const findings = checkOverlaps(layout as LevelLayout,
      volumeRatioThreshold != null ? { volumeRatioThreshold } : undefined);

    const text = findings.length === 0
      ? "No overlaps."
      : findings.map((f) =>
          `OVERLAP ${f.aName} (${f.a})  x  ${f.bName} (${f.b})  ` +
          `@ (${f.centre.x.toFixed(1)}, ${f.centre.y.toFixed(1)}, ${f.centre.z.toFixed(1)})  ` +
          `(${(f.volumeRatio * 100).toFixed(0)}%)`
        ).join("\n");

    return { content: [{ type: "text", text }], isError: findings.length > 0 };
  },
);

server.tool(
  "check_zone_bounds",
  "Runs ONLY the zone-drift check: reports every placement whose bounds extend outside the " +
    "zone that claims it. Catches organic/noise-generated terrain sprawling past its intended " +
    "footprint into a neighbouring zone (a documented real failure this tool descends from).",
  { layout: LevelLayoutSchema },
  async ({ layout }) => {
    const findings = checkBounds(layout as LevelLayout);
    const text = findings.length === 0
      ? "No drift."
      : findings.map((f) => `DRIFT ${f.placementName} (${f.placementId}) outside zone "${f.zoneId}"`).join("\n");
    return { content: [{ type: "text", text }], isError: findings.length > 0 };
  },
);

server.tool(
  "check_reachability",
  "Runs ONLY the jump-reachability check: floods from spawn across every placement tagged " +
    "'floor' using real projectile-motion jump arcs (from the layout's own MovementProfile, " +
    "never a flat gap constant), and reports which floors the flood never reached.",
  { layout: LevelLayoutSchema },
  async ({ layout }) => {
    const report = checkReachability(layout as LevelLayout);
    const text = report.unreachable.length === 0
      ? `All ${report.totalSurfaces} floor(s) reachable from spawn.`
      : `${report.unreachable.length}/${report.totalSurfaces} unreachable:\n` +
        report.unreachable.map((u) =>
          `  ${u.placementName} (${u.placementId}) @ ` +
          `(${u.position.x.toFixed(1)}, ${u.position.y.toFixed(1)}, ${u.position.z.toFixed(1)})`
        ).join("\n");
    return { content: [{ type: "text", text }], isError: report.unreachable.length > 0 };
  },
);

server.tool(
  "max_jump_reach",
  "Given a height difference (dy, metres — positive means climbing) and a MovementProfile, " +
    "returns the maximum horizontal distance a jump can cover. Use this WHILE authoring a " +
    "layout to space platforms correctly, instead of guessing a gap size and finding out later " +
    "from check_reachability that a climb was too tall for the horizontal distance chosen.",
  {
    dy: z.number(),
    gravity: z.number().positive(),
    jumpHeight: z.number().positive(),
    runSpeed: z.number().positive(),
    jumpsAvailable: z.number().int().positive().optional(),
  },
  async ({ dy, gravity, jumpHeight, runSpeed, jumpsAvailable }) => {
    const movement: MovementProfile = { gravity, jumpHeight, runSpeed, maxRisePerStep: 0, jumpsAvailable };
    const reach = maxHorizontalReach(dy, movement);
    return {
      content: [{ type: "text", text: `Max horizontal reach at dy=${dy}: ${reach.toFixed(2)}m` }],
    };
  },
);

server.tool(
  "suggest_repairs",
  "For every current overlap in a LevelLayout, suggests the minimum-translation fix: move the " +
    "non-geometry placement (prop/enemy/etc, never world 'block' geometry when the pair is " +
    "mixed) along whichever axis has the shallowest penetration, just far enough to clear it. " +
    "Returns suggestions, does NOT modify the layout — apply one, then re-run validate_layout, " +
    "the same iterative loop a linter's autofix uses. Fixing one overlap can create a new one " +
    "against a third object, so re-validate rather than applying every suggestion blind.",
  { layout: LevelLayoutSchema },
  async ({ layout }) => {
    const typedLayout = layout as LevelLayout;
    const findings = checkOverlaps(typedLayout);
    if (findings.length === 0) {
      return { content: [{ type: "text", text: "No overlaps — nothing to repair." }] };
    }
    const suggestions = suggestOverlapRepairs(typedLayout, findings);
    const text = suggestions.map((s) =>
      `${s.placementName} (${s.placementId}): move ${s.axis} by ` +
      `${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(2)}m — ${s.reason}`
    ).join("\n");
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "check_boundary_continuity",
  "Checks whether every outdoor zone is actually FLANKED along its whole length, not just " +
    "somewhere in it — tag flanking scenery (ridges, cliff walls, a treeline) with \"boundary\" " +
    "for this to see it. The failure this catches: a zone can pass every other check (no " +
    "overlaps, nothing out of bounds, everything reachable) and still read as a handful of " +
    "floor pads floating in an empty void the moment a camera pulls back, because nothing was " +
    "ever asked to close its edges. Found on a real world where bank ridges were authored for " +
    "the first two zones of a five-zone route and then just stopped — every per-zone geometry " +
    "check was clean and the far zones still looked unfinished from any distance. NOT part of " +
    "validate_layout's hard-fail gate by default (an interior room or an intentional cliff-edge " +
    "vista has no flanking-ridge concept) — call this explicitly once a layout's outdoor zones " +
    "are meant to read as one continuous place.",
  {
    layout: LevelLayoutSchema,
    maxGapMargin: z.number().positive().optional()
      .describe("How far outward from a zone's edge flanking geometry may start and still " +
                "count as closing that edge (default 40 world units)."),
    bandSize: z.number().positive().optional()
      .describe("Sample band width along each zone's long axis (default 20 world units)."),
  },
  async ({ layout, maxGapMargin, bandSize }) => {
    const findings = checkBoundaryContinuity(layout as LevelLayout, { maxGapMargin, bandSize });
    const text = findings.length === 0
      ? "Every zone is flanked along its whole length — no open gaps."
      : findings.map((f) =>
          `OPEN GAP zone "${f.zoneId}" — ${f.side} ${f.axis} edge unflanked near ${f.axis}-band ` +
          `centred at ${f.bandCentre.toFixed(1)}`
        ).join("\n");
    return { content: [{ type: "text", text }], isError: findings.length > 0 };
  },
);

server.tool(
  "check_placement_variety",
  "Checks a group of same-tagged placements (default tag \"boundary\") for whether they are " +
    "actually varied, or just the same prefab copy-pasted along a line. The failure this catches: " +
    "a generator loop that places N copies of ONE prefab with rotationY left at its default reads " +
    "as a fence of identical objects, not a ridge or a skyline — and none of the other checks " +
    "(overlap, bounds, reachability, boundary continuity) can see it, because a fence of identical " +
    "objects has no overlaps, stays in bounds, and closes every gap just fine. Found on a real " +
    "world where a bank-ridge loop used one mountain prefab at Quaternion.identity every time; the " +
    "reporting user's words were \"all of them are the same, it looks horrible.\" Flags any group " +
    "of 4+ same-tagged placements sharing both the same prefabRef AND an ~identical rotationY — " +
    "either axis of variation alone (a mixed prefab kit, or the same prefab rotated differently " +
    "each time) is enough to clear it.",
  {
    layout: LevelLayoutSchema,
    tag: z.string().optional().describe("Only placements carrying this tag are checked (default \"boundary\")."),
    minGroupSize: z.number().int().positive().optional()
      .describe("A group smaller than this is not flagged (default 4)."),
    rotationEpsilonDeg: z.number().nonnegative().optional()
      .describe("How close two rotationY values must be to count as \"the same\" (default 1 degree)."),
  },
  async ({ layout, tag, minGroupSize, rotationEpsilonDeg }) => {
    const findings = checkPlacementVariety(layout as LevelLayout, { tag, minGroupSize, rotationEpsilonDeg });
    const text = findings.length === 0
      ? "No repetitive placement groups found."
      : findings.map((f) =>
          `REPETITIVE ${f.count}x "${f.prefabRef}" tagged "${f.tag}" all share the same rotation — ` +
          `${f.placementIds.slice(0, 5).join(", ")}${f.placementIds.length > 5 ? ", ..." : ""}`
        ).join("\n");
    return { content: [{ type: "text", text }], isError: findings.length > 0 };
  },
);

server.tool(
  "new_layout",
  "Scaffolds an empty LevelLayout with the given id, spawn point and movement profile — the " +
    "starting point for a model to fill in zones and placements against.",
  {
    id: z.string().min(1),
    spawn: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    movement: z.object({
      gravity: z.number().positive(),
      jumpHeight: z.number().positive(),
      runSpeed: z.number().positive(),
      maxRisePerStep: z.number().positive(),
      jumpsAvailable: z.number().int().positive().optional(),
    }),
  },
  async ({ id, spawn, movement }) => {
    const layout: LevelLayout = emptyLayout(id, movement, spawn);
    return { content: [{ type: "text", text: JSON.stringify(layout, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
