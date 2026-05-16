/**
 * Risk and severity → color mapping helpers.
 *
 * `riskColor` / `sevColor` return raw hex (used for SVG fills, chart series,
 * and MapLibre paint expressions). The `*Bg` / `*TextVar` helpers return CSS
 * custom-property references that adapt to the active theme.
 */

/** Continuous risk score (0–1) → hex color. */
export function riskColor(r) {
  if (r >= 0.85) return "#b03030";
  if (r >= 0.65) return "#c07020";
  if (r >= 0.45) return "#b09000";
  return "#208050";
}

/** Risk score → themed background token. */
export function riskBg(r) {
  if (r >= 0.85) return "var(--color-background-danger)";
  if (r >= 0.45) return "var(--color-background-warning)";
  return "var(--color-background-success)";
}

const SEV_COLOR = { CRITICAL: "#b03030", HIGH: "#c07020", MEDIUM: "#b09000", LOW: "#208050" };
const SEV_BG = {
  CRITICAL: "var(--color-background-danger)",
  HIGH: "var(--color-background-warning)",
  MEDIUM: "var(--color-background-warning)",
  LOW: "var(--color-background-success)",
};
const SEV_TEXT = {
  CRITICAL: "var(--color-text-danger)",
  HIGH: "var(--color-text-warning)",
  MEDIUM: "var(--color-text-warning)",
  LOW: "var(--color-text-success)",
};

/** Severity label → hex color. */
export function sevColor(s) {
  return SEV_COLOR[s] || "#888";
}

/** Severity label → themed background token. */
export function sevBg(s) {
  return SEV_BG[s] || "var(--color-background-secondary)";
}

/** Severity label → themed text-color token. */
export function sevTextVar(s) {
  return SEV_TEXT[s] || "var(--color-text-secondary)";
}
