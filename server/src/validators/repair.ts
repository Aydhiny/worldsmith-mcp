import { LevelLayout, Placement, Vec3 } from "../schema.js";
import { OverlapFinding } from "./overlap.js";
import { placementBounds, toMinMax } from "../geometry.js";

export interface RepairSuggestion {
  placementId: string;
  placementName: string;
  axis: "x" | "y" | "z";
  /** Add this to the placement's CURRENT position on the given axis. */
  delta: number;
  reason: string;
}

const MARGIN = 0.05;

/**
 * For each overlap finding, suggests the minimum-translation fix: move the SECOND placement
 * along whichever axis has the LEAST penetration depth, just far enough (plus a small margin)
 * to clear the first one. Standard axis-aligned "minimum translation vector" separation, applied
 * to the exact finding shape `checkOverlaps` already produces.
 *
 * WHY THIS EXISTS: the established pattern for LLM-facing validation (Pydantic AI, Guardrails,
 * Instructor and similar structured-output frameworks) is "validate, then feed the error back for
 * an automatic retry" — this is that pattern's missing other half for Worldsmith specifically.
 * `validate_layout` already returns a precise, structured error; `suggest_repairs` turns that
 * error into a concrete coordinate change a model can apply directly, rather than re-deriving
 * "which way do I move this" from a text description alone (the exact kind of spatial arithmetic
 * this whole project exists to stop trusting an LLM with unchecked).
 *
 * DELIBERATELY NOT AUTOMATIC. This returns suggestions; it does not mutate the layout. Applying a
 * fix blind can cascade (fixing A vs B can create a new overlap between A and C) — the caller
 * should apply one suggestion, then re-validate, same as any other iterative repair loop. This
 * also only ever proposes moving whichever placement is NOT a "block" (world geometry) when the
 * pair is a block-vs-non-block — geometry is usually more load-bearing to a layout's intent than
 * a prop/enemy/collectible placed against it, so the cheaper object moves.
 */
export function suggestOverlapRepairs(layout: LevelLayout, findings: OverlapFinding[]): RepairSuggestion[] {
  const byId = new Map(layout.placements.map((p) => [p.id, p]));
  const suggestions: RepairSuggestion[] = [];

  for (const finding of findings) {
    const a = byId.get(finding.a);
    const b = byId.get(finding.b);
    if (a == null || b == null) continue;

    const mover = pickMover(a, b);
    const anchor = mover === b ? a : b;

    const boundsMover = placementBounds(mover);
    const boundsAnchor = placementBounds(anchor);
    const mm = toMinMax(boundsMover);
    const am = toMinMax(boundsAnchor);

    const penetration = {
      x: Math.min(mm.max.x, am.max.x) - Math.max(mm.min.x, am.min.x),
      y: Math.min(mm.max.y, am.max.y) - Math.max(mm.min.y, am.min.y),
      z: Math.min(mm.max.z, am.max.z) - Math.max(mm.min.z, am.min.z),
    };

    const axis = (["x", "y", "z"] as const).reduce((best, ax) =>
      penetration[ax] < penetration[best] ? ax : best, "x" as "x" | "y" | "z");

    const direction = Math.sign(mover.position[axis] - anchor.position[axis]) || 1;
    const delta = direction * (penetration[axis] + MARGIN);

    suggestions.push({
      placementId: mover.id,
      placementName: mover.name,
      axis,
      delta,
      reason: `Separates from "${anchor.name}" along ${axis} (the shallowest penetration axis, ` +
              `${penetration[axis].toFixed(2)}m deep) by ${delta.toFixed(2)}m.`,
    });
  }

  return suggestions;
}

function pickMover(a: Placement, b: Placement): Placement {
  if (a.kind === "block" && b.kind !== "block") return b;
  if (b.kind === "block" && a.kind !== "block") return a;
  return b; // arbitrary but deterministic when both/neither are geometry
}

export function applySuggestion(layout: LevelLayout, suggestion: RepairSuggestion): LevelLayout {
  const placements = layout.placements.map((p): Placement => {
    if (p.id !== suggestion.placementId) return p;
    const position: Vec3 = { ...p.position, [suggestion.axis]: p.position[suggestion.axis] + suggestion.delta };
    return { ...p, position };
  });
  return { ...layout, placements };
}
