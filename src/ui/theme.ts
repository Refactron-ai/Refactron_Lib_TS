// src/ui/theme.ts
// Semantic color system — modelled on YRC's dark theme palette.
// All existing keys preserved as aliases so no imports break.
export const theme = {
  colors: {
    // ── Brand ───────────────────────────────────────────────────────────
    brand:          '#4a9eff', // primary brand blue (was: accent)
    brandShimmer:   '#7ab8ff', // lighter shimmer variant
    accent:         '#4a9eff', // alias → brand
    primary:        '#1e3a5f', // deep navy (backgrounds, face fill)

    // ── Spinner ──────────────────────────────────────────────────────────
    spinner:        '#4a9eff',
    spinnerShimmer: '#7ab8ff',

    // ── Prompt ───────────────────────────────────────────────────────────
    promptBorder:        '#30363d',
    promptBorderShimmer: '#4a4f56',

    // ── Text ─────────────────────────────────────────────────────────────
    text:    '#e8e8e8',
    textDim: '#888888',  // alias → subtle
    subtle:  '#888888',

    // ── Backgrounds ──────────────────────────────────────────────────────
    bg:             '#0d1117',
    bgAlt:          '#161b22',
    border:         '#30363d',
    userMessageBg:  '#1e2430', // user-turn block background

    // ── Mascot ───────────────────────────────────────────────────────────
    mascot:     '#4a9eff', // body foreground (no backgroundColor — avoids glitch)
    clawd_body: '#4a9eff', // YRC parity: color="clawd_body" on Clawd segments

    // ── Semantic states ───────────────────────────────────────────────────
    success:  '#3fb950',
    error:    '#f85149',
    warning:  '#d29922',
    critical: '#ff4444',
    high:     '#ff8800',
    medium:   '#ffdd00',
    low:      '#44cc44',
    trivial:  '#888888',

    // ── Diff ─────────────────────────────────────────────────────────────
    diffAdded:       '#78bf7a',
    diffRemoved:     '#f47067',
    diffAddedWord:   '#3fb950',
    diffRemovedWord: '#f85149',
    diffAddedDim:    '#2d4a2e',
    diffRemovedDim:  '#4a1e1e',
  },

  symbols: {
    pass:     '✔',
    fail:     '✗',
    arrow:    '→',
    bullet:   '·',
    bar:      '█',
    barEmpty: '░',
    // YRC-style spinner: forward + reverse = 12 frames
    spinner: (() => {
      const base =
        process.platform === 'darwin'
          ? ['·', '✢', '✳', '✶', '✻', '✽']
          : ['·', '✢', '*', '✶', '✻', '✽'];
      return [...base, ...[...base].reverse()];
    })(),
    // Reduced-motion dot (YRC: REDUCED_MOTION_DOT)
    spinnerDot: '●',
  },

  blastColors: {
    trivial:  '#888888',
    low:      '#44cc44',
    medium:   '#ffdd00',
    high:     '#ff8800',
    critical: '#ff4444',
  },

  severityColors: {
    critical: '#ff4444',
    high:     '#ff8800',
    medium:   '#ffdd00',
    low:      '#44cc44',
  },
} as const;

export type Theme = typeof theme;
