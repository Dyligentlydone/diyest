export type Units = "metric" | "imperial";
export type SkillLevel = "beginner" | "intermediate" | "advanced";

export interface Profile {
  id: string;
  display_name: string | null;
  units: Units;
  skill_level: SkillLevel;
  kerf_mm: number;
  stock_sizes: Record<string, unknown>;
  tools_owned: string[];
  plan_tier: "free" | "pro";
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}
