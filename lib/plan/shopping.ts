/**
 * Shopping list — grouped by store section, with rough per-line estimates
 * (marked "est." in the UI) and affiliate_url plumbing (empty until the
 * affiliate programs are wired in M6).
 */
import type { Plan } from "./schema";
import { consumablesOf } from "./derive";
import { stockLabel, type CutList } from "./cutlist";
import type { Units } from "@/lib/types";

export type ShopSection =
  | "lumber"
  | "sheet goods"
  | "hardware & fasteners"
  | "bought parts"
  | "glue & finish";

export interface ShopItem {
  /** stable key for "already have" persistence */
  key: string;
  section: ShopSection;
  name: string;
  spec?: string;
  qty: string;
  /** rough USD estimate — ballpark, flagged "est." */
  estUsd?: number;
  affiliateUrl?: string;
}

export interface ShoppingList {
  sections: { name: ShopSection; items: ShopItem[] }[];
  estTotalUsd: number;
}

const HARDWARE_EST: [RegExp, number][] = [
  [/leg plate|mounting plate|bracket kit|kit/i, 12],
  [/hinge/i, 6],
  [/bolt|threaded insert|hanger bolt/i, 1.5],
  [/clip|z-?clip|figure.?8/i, 0.8],
  [/bracket|corner brace|angle/i, 3],
  [/dowel|biscuit/i, 0.15],
  [/screw|nail|brad/i, 0.08],
  [/knob|handle|pull/i, 4],
  [/anchor|strap/i, 5],
];
const CONSUMABLE_EST: [RegExp, number][] = [
  [/glue/i, 8],
  [/stain|paint|finish|oil|poly|varnish|lacquer|wax/i, 16],
  [/sandpaper|abrasive/i, 6],
  [/filler|sealant|caulk/i, 7],
];

function estFrom(table: [RegExp, number][], name: string, qty: number, fallback: number) {
  const u = table.find(([re]) => re.test(name))?.[1] ?? fallback;
  return Math.round(u * qty * 100) / 100;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Materials the user already has (leftovers mode) → filtered from the list.
 * Matches on material tokens ("birch plywood" hits "… plywood sheet"); only
 * applied to material sections — hardware and glue/finish are always kept.
 */
function matchesMaterial(name: string, owned: string[]): boolean {
  const n = name.toLowerCase();
  return owned.some((o) =>
    o
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((tok) => tok.length >= 3 && !/^\d/.test(tok) && n.includes(tok))
  );
}

export function buildShoppingList(
  plan: Plan,
  cut: CutList,
  units: Units = "metric",
  excludeMaterials: string[] = []
): ShoppingList {
  const items: ShopItem[] = [];

  // lumber + sheet goods come from the optimizer output (what you actually buy)
  const stockGroups = new Map<
    string,
    { n: number; est: number; section: ShopSection }
  >();
  const stockName = new Map<string, string>();
  for (const b of cut.boards) {
    const g = stockGroups.get(b.label) ?? { n: 0, est: 0, section: "lumber" as const };
    g.n += 1;
    g.est += b.estUsd ?? 0;
    stockGroups.set(b.label, g);
    stockName.set(b.label, stockLabel(b, units));
  }
  for (const s of cut.sheets) {
    const g = stockGroups.get(s.label) ?? { n: 0, est: 0, section: "sheet goods" as const };
    g.n += 1;
    g.est += s.estUsd ?? 0;
    stockGroups.set(s.label, g);
    stockName.set(s.label, stockLabel(s, units));
  }
  for (const [label, g] of stockGroups)
    items.push({
      key: `stock-${slug(label)}`,
      section: g.section,
      name: stockName.get(label) ?? label,
      qty: `×${g.n}`,
      estUsd: g.est || undefined,
    });

  // loose / "other" parts — material to figure out, no estimate
  for (const l of cut.loose)
    items.push({
      key: `loose-${l.partId}`,
      section: "lumber",
      name: `${l.partId} ${l.name}`,
      spec: l.note,
      qty: "as noted",
    });

  for (const h of plan.hardware)
    items.push({
      key: `hw-${slug(h.name + (h.size ?? ""))}`,
      section: "hardware & fasteners",
      name: h.name,
      spec: h.size ?? h.notes ?? undefined,
      qty: `×${h.qty}`,
      estUsd: estFrom(HARDWARE_EST, h.name, Math.min(h.qty, 40), 0.1),
    });

  for (const p of plan.parts.filter((p) => p.source === "buy"))
    items.push({
      key: `buy-${p.id}`,
      section: "bought parts",
      name: p.name,
      spec: p.buy_spec ?? undefined,
      qty: `×${p.qty}`,
      estUsd: /leg|foot/i.test(p.name) ? 9 * p.qty : undefined,
    });

  for (const c of consumablesOf(plan))
    items.push({
      key: `con-${slug(c.name)}`,
      section: "glue & finish",
      name: c.name,
      spec: c.note ?? undefined,
      qty: c.qty ?? "1",
      estUsd: estFrom(CONSUMABLE_EST, c.name, 1, 8),
    });

  const order: ShopSection[] = [
    "lumber",
    "sheet goods",
    "hardware & fasteners",
    "bought parts",
    "glue & finish",
  ];
  const sections = order
    .map((name) => ({ name, items: items.filter((i) => i.section === name) }))
    .filter((s) => s.items.length);
  // leftovers mode: drop material-section items the user already owns
  const MATERIAL_SECTIONS = new Set(["lumber", "sheet goods", "bought parts"]);
  const kept = excludeMaterials.length
    ? sections
        .map((s) =>
          MATERIAL_SECTIONS.has(s.name)
            ? {
                ...s,
                items: s.items.filter(
                  (i) => !matchesMaterial(i.name, excludeMaterials)
                ),
              }
            : s
        )
        .filter((s) => s.items.length)
    : sections;
  const estTotalUsd = Math.round(
    kept.flatMap((s) => s.items).reduce((s, i) => s + (i.estUsd ?? 0), 0) * 100
  ) / 100;

  return { sections: kept, estTotalUsd };
}

/** Plain-text copy for clipboard/print. */
export function shoppingListText(list: ShoppingList, currency = "USD"): string {
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  const lines: string[] = [];
  for (const s of list.sections) {
    lines.push(s.name.toUpperCase());
    for (const i of s.items)
      lines.push(
        `  ${i.qty}  ${i.name}${i.spec ? ` — ${i.spec}` : ""}${i.estUsd ? `  (~${money(i.estUsd)} est)` : ""}`
      );
    lines.push("");
  }
  lines.push(`Estimated materials total: ~${money(list.estTotalUsd)} (rough estimate)`);
  return lines.join("\n");
}
