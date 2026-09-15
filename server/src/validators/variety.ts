import { LevelLayout, Placement } from "../schema.js";

export interface VarietyFinding {
  type: "repetitive-placements";
  tag: string;
  prefabRef: string;
  count: number;
  placementIds: string[];
}

export interface VarietyOptions {
  /** Only placements carrying this tag are checked (default "boundary" — the case this was
   *  built from: a long run of the same prop tagged as flanking/backdrop scenery). */
  tag?: string;
  /** A group smaller than this is not flagged — three of the same rock in a whole layout is
   *  normal set dressing, not a repeated fence. Default 4. */
  minGroupSize?: number;
  /** Two placements count as "the same rotation" when their rotationY values are within this
   *  many degrees of each other. Default 1. */
  rotationEpsilonDeg?: number;
}

/**
 * THE FAILURE THIS CATCHES: a generator loop that places N copies of ONE prefab along a line
 * with `rotationY` left at its default reads as a fence of identical objects, not a ridge or a
 * skyline — even when every geometry check (overlap, bounds, reachability, boundary continuity)
 * passes clean, because none of them look at whether repeated dressing has any VARIETY. Found on
 * the same real world `boundary.ts` is descended from: the bank-ridge loop fixed for continuity
 * used a single mountain prefab with `Quaternion.identity` every time, and the result was, in the
 * reporting user's own words, "these background rocks and stuff... all of them are the same, it
 * looks horrible." CLAUDE.md's own worked example makes the same point about a skyline needing
 * "mixed shapes... and slight tilt so nothing reads as a stamped copy of its neighbour" — this is
 * that principle as a check instead of a paragraph someone has to remember to re-read.
 *
 * Flags any group of `minGroupSize`+ same-tagged placements that share BOTH the same `prefabRef`
 * AND an (approximately) identical `rotationY`. Either axis of variation alone is enough to clear
 * it — a repeated prefab rotated differently each time, or several different prefabs all at the
 * same rotation, both read as intentional variety rather than a copy-paste loop.
 */
export function checkPlacementVariety(
  layout: LevelLayout,
  options: VarietyOptions = {},
): VarietyFinding[] {
  const tag = options.tag ?? "boundary";
  const minGroupSize = options.minGroupSize ?? 4;
  const eps = options.rotationEpsilonDeg ?? 1;

  const relevant = layout.placements.filter(
    (p) => p.prefabRef != null && (p.tags ?? []).includes(tag),
  );

  const byRef = new Map<string, Placement[]>();
  for (const p of relevant) {
    const key = p.prefabRef as string;
    const arr = byRef.get(key) ?? [];
    arr.push(p);
    byRef.set(key, arr);
  }

  const findings: VarietyFinding[] = [];
  for (const [prefabRef, group] of byRef) {
    if (group.length < minGroupSize) continue;

    const first = (group[0].rotationY ?? 0);
    const allSameRotation = group.every((p) => angleDiff(p.rotationY ?? 0, first) <= eps);
    if (!allSameRotation) continue; // rotation variety alone is enough to clear this group

    findings.push({
      type: "repetitive-placements",
      tag,
      prefabRef,
      count: group.length,
      placementIds: group.map((p) => p.id),
    });
  }

  return findings;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
