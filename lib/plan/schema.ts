import { z } from "zod";

/**
 * Plan JSON schema — the contract between the AI and our code.
 * Must stay in sync with lib/ai/prompts/plan.v1.ts (PROMPT_VERSION plan.v1.2).
 *
 * All dimensions are millimeters. World axes: origin = front-bottom-left
 * corner of the finished piece; x = left→right, y = bottom→top, z = front→back.
 */

// ---------- geometry ----------

export const boxPlacementSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  sx: z.number().positive(),
  sy: z.number().positive(),
  sz: z.number().positive(),
});

/**
 * [x, y, z] — serialized as a fixed-length array. (OpenAI strict structured
 * outputs can't express tuple `items`, so we emit array+min/max and keep the
 * tuple type for our own code.)
 */
export const vec3Schema = z
  .array(z.number())
  .length(3) as unknown as z.ZodType<[number, number, number]>;

export const axisPlacementSchema = z.object({
  from: vec3Schema,
  to: vec3Schema,
  roll_deg: z.number().nullable().optional(),
});

export type BoxPlacement = z.infer<typeof boxPlacementSchema>;
export type AxisPlacement = z.infer<typeof axisPlacementSchema>;
export type Placement = BoxPlacement | AxisPlacement;

export function isAxisPlacement(p: Placement): p is AxisPlacement {
  return "from" in p;
}

export const profileSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect") }),
  z.object({ type: z.literal("rounded_rect"), radius: z.number().positive() }),
  z.object({ type: z.literal("circle") }),
  z.object({ type: z.literal("ellipse") }),
  z.object({
    type: z.literal("path"),
    d: z.string(),
    holes: z.array(z.string()).nullable().optional(),
  }),
]);

export const crossSectionSchema = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("rect"),
    w: z.number().positive(),
    t: z.number().positive(),
    end_w: z.number().positive().nullable().optional(),
    end_t: z.number().positive().nullable().optional(),
  }),
  z.object({
    shape: z.literal("round"),
    d: z.number().positive(),
    end_d: z.number().positive().nullable().optional(),
  }),
]);

export type Profile = z.infer<typeof profileSchema>;
export type CrossSection = z.infer<typeof crossSectionSchema>;

// ---------- plan ----------

export const partSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  material: z.string().min(1),
  stock: z.enum(["board", "sheet", "dowel", "other"]),
  length_mm: z.number().positive(),
  width_mm: z.number().positive(),
  thickness_mm: z.number().positive(),
  qty: z.number().int().positive(),
  placements: z.array(z.union([boxPlacementSchema, axisPlacementSchema])),
  profile: profileSchema.nullable().optional(),
  cross_section: crossSectionSchema.nullable().optional(),
  ends: z.enum(["square", "level"]).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const planSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  est_hours: z.number().nonnegative(),
  est_cost: z.object({
    low: z.number().nonnegative(),
    high: z.number().nonnegative(),
    currency: z.string().min(1),
  }),
  overall_dimensions_mm: z.object({
    width: z.number().positive(),
    depth: z.number().positive(),
    height: z.number().positive(),
  }),
  assumptions: z.array(z.string()),
  clarifying_questions: z.array(z.string()),
  // Arrays may be empty: the prompt returns empty arrays for NOT_BUILDABLE
  // responses. "A buildable plan must have parts" is enforced by validate.ts.
  parts: z.array(partSchema),
  hardware: z.array(
    z.object({
      name: z.string().min(1),
      size: z.string().nullable().optional(),
      qty: z.number().positive(),
      notes: z.string().nullable().optional(),
    })
  ),
  finishes: z.array(
    z.object({
      name: z.string().min(1),
      qty: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    })
  ),
  tools: z.array(
    z.object({
      name: z.string().min(1),
      required: z.boolean(),
      alternative: z.string().nullable().optional(),
    })
  ),
  steps: z.array(
    z.object({
      n: z.number().int().positive(),
      title: z.string().min(1),
      text: z.string().min(1),
      parts_used: z.array(z.string()),
      tools_used: z.array(z.string()),
      safety: z.string().nullable().optional(),
      tip: z.string().nullable().optional(),
    })
  ),
  safety_overview: z.array(z.string()),
  load_bearing: z.boolean(),
});

export type Part = z.infer<typeof partSchema>;
export type Plan = z.infer<typeof planSchema>;

/** The AI's escape hatch for non-projects (per plan.v1 prompt). */
export const NOT_BUILDABLE_TITLE = "NOT_BUILDABLE";
