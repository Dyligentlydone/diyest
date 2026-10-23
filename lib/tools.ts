/**
 * Canonical tool catalog — the names the checklist UI, the AI prompts and the
 * validator all share. AI-emitted tool names are mapped to canonical names in
 * code so "impact driver", "power drill" and "drill" all land on "drill/driver".
 */

export interface ToolCategory {
  name: string;
  tools: string[];
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: "Measuring & marking",
    tools: [
      "tape measure",
      "pencil",
      "combination square",
      "speed square",
      "marking gauge",
      "level",
      "straightedge",
      "chalk line",
    ],
  },
  {
    name: "Hand tools",
    tools: [
      "hand saw",
      "coping saw",
      "chisel set",
      "mallet",
      "hammer",
      "screwdrivers",
      "hand plane",
      "block plane",
      "rasp & files",
      "utility knife",
      "hex keys",
      "wrench set",
      "pliers",
      "scraper",
    ],
  },
  {
    name: "Power tools",
    tools: [
      "drill/driver",
      "impact driver",
      "circular saw",
      "miter saw",
      "jigsaw",
      "table saw",
      "track saw",
      "bandsaw",
      "orbital sander",
      "router",
      "planer",
      "nail gun",
      "multitool",
      "drill press",
    ],
  },
  {
    name: "Clamping & workholding",
    tools: [
      "bar clamps",
      "F-clamps",
      "spring clamps",
      "corner clamps",
      "vise",
      "sawhorses",
      "workbench",
      "pocket-hole jig",
      "dowel jig",
    ],
  },
  {
    name: "Safety & cleanup",
    tools: [
      "safety glasses",
      "hearing protection",
      "dust mask / respirator",
      "work gloves",
      "shop vacuum",
    ],
  },
];

export const ALL_TOOLS: string[] = TOOL_CATEGORIES.flatMap((c) => c.tools);

const CANON = new Map(ALL_TOOLS.map((t) => [t, t]));

/**
 * Aliases: lowercase alias → canonical name. Anything the model is likely to
 * write that isn't already canonical.
 */
const ALIASES: [string, string][] = [
  ["tape", "tape measure"],
  ["measuring tape", "tape measure"],
  ["rule", "tape measure"],
  ["ruler", "tape measure"],
  ["square", "combination square"],
  ["combination square or speed square", "combination square"],
  ["pencil or marking knife", "pencil"],
  ["marking knife", "pencil"],
  ["drill", "drill/driver"],
  ["power drill", "drill/driver"],
  ["cordless drill", "drill/driver"],
  ["drill/driver with bits", "drill/driver"],
  ["drill & driver", "drill/driver"],
  ["impact", "impact driver"],
  ["impact wrench", "impact driver"],
  ["screwdriver", "screwdrivers"],
  ["screwdriver set", "screwdrivers"],
  ["saw", "hand saw"],
  ["handsaw", "hand saw"],
  ["japan saw", "hand saw"],
  ["pull saw", "hand saw"],
  ["chop saw", "miter saw"],
  ["mitre saw", "miter saw"],
  ["compound miter saw", "miter saw"],
  ["skill saw", "circular saw"],
  ["skilsaw", "circular saw"],
  ["sander", "orbital sander"],
  ["random orbital sander", "orbital sander"],
  ["random orbit sander", "orbital sander"],
  ["random-orbit sander", "orbital sander"],
  ["belt sander", "orbital sander"],
  ["oscillating tool", "multitool"],
  ["oscillating multitool", "multitool"],
  ["brad nailer", "nail gun"],
  ["pin nailer", "nail gun"],
  ["finish nailer", "nail gun"],
  ["clamp", "bar clamps"],
  ["clamps", "bar clamps"],
  ["bar clamp", "bar clamps"],
  ["pipe clamps", "bar clamps"],
  ["f-clamp", "F-clamps"],
  ["f clamps", "F-clamps"],
  ["quick clamps", "F-clamps"],
  ["trigger clamps", "F-clamps"],
  ["c-clamps", "F-clamps"],
  ["spring clamp", "spring clamps"],
  ["pocket hole jig", "pocket-hole jig"],
  ["kreg jig", "pocket-hole jig"],
  ["kreg pocket hole jig", "pocket-hole jig"],
  ["doweling jig", "dowel jig"],
  ["glasses", "safety glasses"],
  ["eye protection", "safety glasses"],
  ["ear protection", "hearing protection"],
  ["ear defenders", "hearing protection"],
  ["earmuffs", "hearing protection"],
  ["dust mask", "dust mask / respirator"],
  ["respirator", "dust mask / respirator"],
  ["gloves", "work gloves"],
  ["shop vac", "shop vacuum"],
  ["vacuum", "shop vacuum"],
  ["shop towels", "shop vacuum"],
  ["allen keys", "hex keys"],
  ["allen wrenches", "hex keys"],
  ["wrenches", "wrench set"],
  ["spanner set", "wrench set"],
  ["files", "rasp & files"],
  ["wood rasp", "rasp & files"],
  ["sandpaper", "orbital sander"],
  ["plane", "hand plane"],
  ["jack plane", "hand plane"],
  ["vise grip", "vise"],
  ["work bench", "workbench"],
  ["sawhorse", "sawhorses"],
  ["horse", "sawhorses"],
  ["dremel", "multitool"],
  ["angle grinder", "multitool"],
];

const ALIAS_MAP = new Map(ALIASES);

/**
 * Map an AI-emitted tool name to its canonical name, or null if no match.
 * Matching is case-insensitive, ignores punctuation/extra words like "set of".
 */
export function canonicalTool(name: string): string | null {
  const n = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\bor\b.*/g, "")
    .replace(/[-–—/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  if (CANON.has(n)) return CANON.get(n)!;
  const alias = ALIAS_MAP.get(n);
  if (alias) return alias;
  // substring containment both ways ("circular saw or jigsaw" → circular saw)
  for (const t of ALL_TOOLS) {
    const tc = t.toLowerCase().replace(/[-/]/g, " ");
    if (n === tc || n.startsWith(`${tc} `) || tc.startsWith(`${n} `))
      return t;
  }
  for (const [a, t] of ALIAS_MAP) {
    if (n.startsWith(`${a} `) || a.startsWith(`${n} `)) return t;
  }
  return null;
}

/**
 * Normalize a list of tool names: canonical where known, otherwise the
 * original text kept verbatim (treated as a custom tool).
 */
export function normalizeTools(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const c = canonicalTool(name) ?? name.trim();
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    out.push(c);
  }
  return out;
}
