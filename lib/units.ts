import type { Units } from "./types";

/** mm → display string in the user's units. Imperial: feet-inches, /16" fractions. */
export function formatLength(mm: number, units: Units): string {
  if (units === "metric") return `${Math.round(mm)} mm`;
  const inches = mm / 25.4;
  const whole = Math.floor(inches);
  const six = Math.round((inches - whole) * 16);
  if (six === 16) return `${whole + 1}"`;
  if (six === 0) return `${whole}"`;
  let num = six,
    den = 16;
  while (num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return `${whole ? whole + " " : ""}${num}/${den}"`;
}

/** Compact form for tables/dimensions (no " mm" suffix for metric). */
export function formatDimension(mm: number, units: Units): string {
  if (units === "metric") return `${Math.round(mm)}`;
  return formatLength(mm, units);
}

/** Parse a user-entered length into mm, honoring their unit choice. */
export function toMm(value: number, units: Units): number {
  return units === "imperial" ? value * 25.4 : value;
}

export function formatDimensions(
  dims: { width: number; depth: number; height: number },
  units: Units
): string {
  return `${formatLength(dims.width, units)} W × ${formatLength(dims.depth, units)} D × ${formatLength(dims.height, units)} H`;
}
