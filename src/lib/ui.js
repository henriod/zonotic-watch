/**
 * Shared inline-style fragments for the dashboard.
 *
 * The dashboard styles with inline `style` objects rather than CSS classes;
 * this file holds the handful of surface styles repeated across panels so
 * they stay consistent. Spread into a component's style: `{ ...panel, ... }`.
 */

/** Card surface — primary background, hairline border, large radius. */
export const panel = {
  background: "var(--color-background-primary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-lg)",
};
