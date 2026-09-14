import { z } from "zod";

/**
 * Runtime validation for LevelLayout at the MCP tool boundary. Kept separate from the plain TS
 * interfaces in schema.ts on purpose: those types are the internal contract every validator and
 * the Unity-side builder compile against, this is the "is the JSON a model just handed me even
 * shaped right" check — the FIRST gate, before any geometry math runs at all.
 */

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const AABBSchema = z.object({
  center: Vec3Schema,
  size: Vec3Schema,
});

export const PlacementKindSchema = z.enum([
  "block", "prop", "enemy", "collectible", "hazard", "checkpoint",
]);

export const PlacementSchema = z.object({
  id: z.string().min(1),
  kind: PlacementKindSchema,
  name: z.string().min(1),
  position: Vec3Schema,
  rotationY: z.number().optional(),
  size: Vec3Schema,
  prefabRef: z.string().optional(),
  solid: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  groupId: z.string().optional(),
});

export const ZoneSchema = z.object({
  id: z.string().min(1),
  bounds: AABBSchema,
  placementIds: z.array(z.string()),
});

export const MovementProfileSchema = z.object({
  gravity: z.number().positive(),
  jumpHeight: z.number().positive(),
  runSpeed: z.number().positive(),
  maxRisePerStep: z.number().positive(),
  jumpsAvailable: z.number().int().positive().optional(),
});

export const LevelLayoutSchema = z.object({
  id: z.string().min(1),
  zones: z.array(ZoneSchema),
  placements: z.array(PlacementSchema),
  spawn: Vec3Schema,
  movement: MovementProfileSchema,
});
