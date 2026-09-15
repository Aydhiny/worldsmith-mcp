<img src="docs/logo.svg" width="72" height="72" align="left" alt="" style="margin-right:16px" />

# Worldsmith

An MCP server + Unity package for building 3D game levels with an LLM, built around one claim:
**an LLM should never be trusted to place geometry by writing placement code directly.** It
should write *data* (a `LevelLayout`, plain JSON), and that data must pass deterministic geometry
checks — overlap, zone bounds, jump reachability — before a single GameObject is allowed to
exist. A builder only ever consumes an already-validated layout.

## Why this exists

This is not a hypothetical concern. It's the writeup of a real incident.

An earlier session used Claude Code + Unity MCP to hand-author a desert/pyramid world for a
platformer, directly: one C# editor script computing ~130 object positions from arithmetic that
looked reasonable line-by-line. The result shipped with:

- A "distant landmark" pyramid — a decorative backdrop, 78m across — built with **real collision**
  at the *same coordinates* as the entire walkable dungeon underneath it. The player was
  constantly clipping through solid rock while walking through what was supposed to be a hollow
  corridor.
- A hazard object whose position was only ever set at play-time; every edit-time inspection saw
  it sitting at the world origin, embedded in unrelated terrain.
- Procedurally-generated dune terrain that sprawled roughly 50m past its intended boundary — an
  underestimate of how far Perlin-noise-driven geometry actually spreads — burying a statue and
  its floor in a neighbouring zone by up to 90%.
- Two hazards built literally inside a solid statue.
- Enemies embedded in terrain after a later edit reshaped the ground under their fixed
  placement offsets.
- A "boss room" with a floor and a ceiling and **no walls** — two flat slabs floating in open
  sky, because nothing ever checked that the enclosed volume was actually enclosed.

None of this threw an exception. None of it failed a compile. The console was clean. It was only
caught because a human said "this looks broken" and a purpose-built diagnostic tool was written
*after the fact* to go find out why. That tool worked — every bug above has a specific, fixable
cause once you go looking — but "after the fact, because a human complained" is not a pipeline,
it's a postmortem. Worldsmith is what that diagnostic tool looks like generalized, moved to the
front of the pipeline, and made mandatory.

This isn't a motivation problem. Current research on LLM spatial reasoning (see
[SpatialLLM](https://arxiv.org/pdf/2505.00788),
[SpatialClaw](https://arxiv.org/pdf/2606.13673)) is explicit that holding 3D spatial relationships
correctly in a forward pass is a structural weakness, not a carelessness one. The fix has to be
architectural: externalize the check into code that actually computes it, every time, not "be more
careful."

## Architecture

```
   LLM writes JSON              worldsmith-mcp validates            builder consumes ONLY
   (a LevelLayout)         ──►   (pure geometry math,          ──►   an already-validated
                                  no Unity needed)                    layout
```

**1. The model writes a `LevelLayout`** — zones, placements (position + bounding size + optional
prefab reference), a spawn point, a movement profile. See [`server/src/schema.ts`](server/src/schema.ts).

**2. `worldsmith-mcp` validates it — three deterministic checks, all pure math, no engine:**

- **Overlap** ([`validators/overlap.ts`](server/src/validators/overlap.ts)) — flags any two solid
  placements sharing more than a configurable fraction of the smaller one's volume. Siblings
  sharing a `groupId` (a statue's paws against its body, an enemy's hurtbox against its own root)
  are correctly excluded; hazard/trigger volumes (`solid: false`) are excluded entirely, because a
  hazard overlapping the floor it sits on is how hazards work.
- **Zone bounds** ([`validators/bounds.ts`](server/src/validators/bounds.ts)) — flags any
  placement whose bounds extend outside the zone that claims it. This is the dune-sprawl bug,
  generalized: organic/noise-based generation reliably extends further than its nominal radius
  suggests, and only checking the *actual* result catches it.
- **Reachability** ([`validators/reachability.ts`](server/src/validators/reachability.ts)) —
  floods from spawn across every `floor`-tagged placement using real projectile-motion jump arcs
  computed from the layout's own `MovementProfile` (gravity, jump height, run speed), never a flat
  "gap size" constant, and reports which floors the flood never reached.
- **Boundary continuity** ([`validators/boundary.ts`](server/src/validators/boundary.ts)) — checks
  whether every outdoor zone is FLANKED along its whole length by `boundary`-tagged geometry
  (ridges, cliff walls, a treeline), not just somewhere in it. Found on a real world where bank
  ridges were authored for the first two zones of a five-zone route and then simply stopped — every
  other check passed clean, and the far zones still read as floor pads floating in an empty void
  the moment a camera pulled back. Not part of `validate_layout`'s hard-fail gate by default (an
  interior room or a deliberate cliff-edge vista has no "flanking ridge" concept); call
  `check_boundary_continuity` explicitly once a layout's outdoor zones are meant to read as one
  continuous place.

Run the geometry checks together with the `validate_layout` MCP tool, or individually while
iterating with `check_overlaps` / `check_zone_bounds` / `check_reachability` /
`check_boundary_continuity`. `max_jump_reach` answers "how far CAN a jump go from here" while a
layout is still being authored, instead of finding out after the fact that a climb was too tall
for the horizontal gap chosen.

**`suggest_repairs`** closes the loop that `validate_layout` opens. The established pattern for
LLM-facing structured output (Pydantic AI, Guardrails AI, Instructor: validate, then feed the
error back for an automatic retry) needs the error to be something a model can *act on directly*,
not just read. For every overlap, `suggest_repairs`
([`validators/repair.ts`](server/src/validators/repair.ts)) computes the minimum-translation fix —
move the non-geometry object along whichever axis has the shallowest penetration, just far enough
to clear it — and returns a concrete `{axis, delta}`. It never mutates the layout itself: apply
one suggestion, re-run `validate_layout`, repeat. Fixing one overlap can create a new one against a
third object, so this is an iterative loop, not a one-shot autofix.

**3. A builder consumes only what passed.** The included Unity package
([`unity-package/`](unity-package/)) is a reference implementation: `WorldsmithBuilder` reads the
validated JSON and instantiates it, attaching a `WorldsmithInstance` marker (id + group + solidity)
to everything it places. It is deliberately small — real projects will want their own builder that
knows their asset catalog, their material conventions, their prefab library — the point is that
*whatever* builder you write, it should only ever read from a layout this pipeline approved.

**4. Defense in depth: a live-scene audit runs after the build too.**
`WorldsmithOverlapAudit` (generalized from the tool that diagnosed the original incident) re-checks
the actual instantiated colliders, because the pre-build JSON check and the post-build live check
catch *different* failure classes. The JSON check is cheap and catches most placement mistakes
before Unity is even open. The live check catches things the JSON model can't see — a prefab whose
real collider doesn't match its declared size, or (a bug hit building this tool's own predecessor)
a freshly-instantiated object's `Collider.bounds` being stale until PhysX syncs its scene, which
produced literal-world-origin false positives until the fix
(`Physics.SyncTransforms()`) was added.

## Other ways in

**A browser UI** ([`ui/index.html`](ui/index.html)) — paste or edit a `LevelLayout`, hit Validate,
see the report AND a live top-down + side blueprint view: zones as dashed outlines, placements
colored by kind, overlaps outlined in red with an X at the overlap centre, unreachable floors
outlined in amber. "Suggest repairs" appends the repair-tool's output to the report. It runs the
*exact same validator code* as the MCP server and the CLI — `npm run build` bundles
`server/src/browser.ts` (schema + geometry + all four validators, nothing Node-specific) into
`ui/vendor/worldsmith-core.js` with esbuild, so there is no second implementation to drift out of
sync. Needs to be served, not opened as a `file://` URL (browsers block ES module imports over
`file://`):

```bash
npx serve .        # from the repo root, then open http://localhost:3000/ui/
```

**A CLI** (`server/src/cli.ts`, built to `dist/cli.js`) for using the validators without an MCP
client at all — CI, a pre-commit hook, a quick terminal check:

```bash
npm run build
node dist/cli.js validate path/to/layout.json    # exits non-zero on any finding, like a linter
node dist/cli.js repair path/to/layout.json       # prints suggested fixes for current overlaps
```

**A standalone JSON Schema** ([`docs/level-layout.schema.json`](docs/level-layout.schema.json),
regenerate with `npm run export-schema`) — projected from the same zod schema that gates the MCP
tools, for editor autocomplete, a different language's own validator, or a model's function-calling
schema. The zod schema stays the single source of truth; this is a read-only projection of it.

## What this does NOT solve (read before you trust it)

Being honest about the edges matters more than the pitch. Specifically:

- **Organic/heightfield terrain isn't represented by this schema.** The `Placement` AABB model is
  a good fit for blocky/architectural geometry (walls, floors, stairs, props) and a poor fit for
  Perlin-noise terrain, whose actual silhouette isn't a box. The zone-bounds check still catches
  gross sprawl (an AABB around the terrain generator's claimed footprint vs. its zone), but it
  cannot see fine-grained shape the way the live Unity audit's real raycasts/colliders can. If your
  world leans heavily on organic terrain, budget for the live-scene audit doing real work, not the
  pre-build JSON check.
- **Rotation is yaw-only, and AABBs approximate rotated objects loosely.** A long thin object
  rotated 45° needs a bounding box sized for its diagonal, or true oriented-box overlap (not
  implemented in v0.1) — passing its unrotated size will under-report overlap risk.
- **Multi-jump reach is a linear approximation.** `MovementProfile.jumpsAvailable > 1` multiplies
  single-jump reach rather than modeling real chained arcs with per-jump weakening (as a real
  double/triple-jump system usually has). Set `jumpsAvailable: 1` for an exact answer; treat higher
  values as "roughly this far," not a guarantee.
- **The C# schema mirror is hand-synced, not generated.** `unity-package/Runtime/WorldsmithLayout.cs`
  must be kept in step with `server/src/schema.ts` by hand. There is no codegen step in v0.1 — a
  schema change is a two-file change, and nothing currently enforces that other than this sentence.
- **This has not yet been proven on a second, independent project.** It was built to generalize a
  real, specific incident and its fix. It has unit tests reconstructing that incident (see
  `server/src/test/validate.test.ts`) and they pass, but "passes tests derived from the case that
  motivated it" and "reliable on a Unity project this was never tuned against" are different
  claims, and only the first one is true yet.

## Status

v0.1. TypeScript builds clean, `npm test` passes (10/10, including a direct regression test for
the original incident's overlap bug and a test that a repair suggestion actually clears the
overlap it targets). The browser UI is verified working end-to-end — served locally, loaded, and
confirmed to both render a clean layout correctly and visually flag a reconstructed version of the
original incident's overlap in red with a marker at the overlap centre. The Unity package compiles
against standard editor APIs but has not yet been run inside a live Unity project as part of this
pipeline end-to-end — that's the next milestone, not a claim already made here.

**Used by:** registered as an MCP server (`worldsmith`) for the Puntsy project this tool was
generalized from — see `.mcp.json` there. Restart the Claude Code session on that project to pick
up the tools; an already-running session doesn't hot-reload its MCP server list.

## Roadmap / ways to extend this

Researched against the current landscape (Promethean AI, various JSON-Schema-for-game-layout
efforts, the LLM-structured-output validation ecosystem) rather than guessed. Roughly in order of
value:

1. **True oriented-box overlap** for rotated placements, replacing the yaw-ignored AABB
   approximation — the biggest accuracy gap in v0.1's overlap check.
2. **A prefab catalog constraint pass** (seen in comparable tools as a "LayoutSanitizer"): validate
   that every `prefabRef` resolves against a supplied manifest, and cap counts per kind, before the
   builder ever runs — catches a hallucinated asset path as a validation failure instead of a
   builder-time warning.
3. **Codegen for the C#/TS schema pair** instead of hand-sync — either generate `WorldsmithLayout.cs`
   from `schema.zod.ts`, or add a CI check that fails when the two drift.
4. **A real chained multi-jump reachability model** instead of the linear `jumpsAvailable`
   approximation, for games whose second/third jump is intentionally weaker (this project's own
   motivating case is exactly that kind of game).
5. **Prove it on a second, unrelated Unity project.** Everything here is validated against the
   incident that motivated it; the next real test is a project this was never tuned against.

## Layout

```
server/               MCP server (TypeScript) — the validators, the schema, the MCP tools
  src/schema.ts          LevelLayout types
  src/schema.zod.ts       runtime validation at the MCP tool boundary
  src/geometry.ts         AABB math shared by every validator
  src/validators/         overlap.ts, bounds.ts, reachability.ts, repair.ts
  src/validate.ts          orchestrates overlap + bounds + reachability into one pass/fail gate
  src/index.ts              the MCP server (validate_layout, check_*, suggest_repairs, max_jump_reach, new_layout)
  src/cli.ts                 terminal/CI entry point (validate, repair)
  src/export-schema.ts        projects schema.zod.ts to docs/level-layout.schema.json
  src/browser.ts               entry point esbuild bundles into ui/vendor/ for the browser UI
  src/test/                    regression tests, including the original incident reconstructed

unity-package/         Unity package (C#) — reference builder + live-scene audit
  Runtime/                WorldsmithLayout.cs (schema mirror), WorldsmithInstance.cs (marker component)
  Editor/                  WorldsmithBuilder.cs, WorldsmithOverlapAudit.cs

ui/                     Browser Layout Inspector (validate + blueprint view), served statically
docs/                   logo.svg, the generated JSON Schema
examples/               A worked LevelLayout that validates cleanly
```

## Quick start

```bash
cd server
npm install
npm run build       # compiles the server AND bundles ui/vendor/worldsmith-core.js for the browser UI
npm test            # 10/10 — includes a regression test for the incident that motivated this project
```

Point an MCP-capable client at `server/dist/index.js` (stdio transport) to use the tools directly,
or `npm run dev` to run it via `tsx` without a build step. From the repo root, `npx serve .` and
open `http://localhost:3000/ui/` for the browser Layout Inspector.

## License

MIT.
