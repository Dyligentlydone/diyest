import { zodResponseFormat } from "openai/helpers/zod";
const { genPlanSchema } = await import("../lib/plan/schema.ts");
const { jointRepairSchema } = await import("../lib/ai/prompts/plan.v1.4.ts");
for (const [name, s] of [["genPlan", genPlanSchema], ["jointRepair", jointRepairSchema]])
  try { zodResponseFormat(s, name); console.log(name, "strict-clean"); }
  catch (e) { console.log(name, "FAIL", e.message.slice(0,200)); }
