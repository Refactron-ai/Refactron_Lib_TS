// src/cli/format-types.ts
// Shared rendered-line shape returned by the CLI formatters. A line carries
// its text and an optional color hint; the printer side (Ink, plain stdout,
// JSON) decides how to realize the color.

export interface RenderedLine {
  text: string;
  color?: string;
}
