// src/ui/theme.ts
// Semantic color system, aligned with the Refactron brand.
// All existing keys preserved as aliases so no imports break.
//
// THE RULE: the chrome is monochrome, the information is not.
//
// Everything structural — brand, accent, spinner, cursors, borders, selection —
// is the cream-on-ink ladder the mark and the website already use, so the only
// coloured things on screen are the ones carrying meaning: a verdict, a severity
// level, a diff. Previously the chrome was #4a9eff, which competed with those
// for attention and matched nothing else Refactron ships.
//
// Values are the website's tokens verbatim (refactron-web src/app/globals.css),
// with one deliberate substitution noted at `brand` below.
export const theme = {
  colors: {
    // ── Brand ───────────────────────────────────────────────────────────
    // The website's accent is --color-teal #efece5, and it does NOT transfer:
    // there it is separated from body text by size and weight, while here it
    // carries binary state (`selected ? brand : text`, cursors, the caret). At
    // #efece5 against cream text a selected row would be indistinguishable from
    // an unselected one. This takes --color-teal-bright instead, which is the
    // same system one step up and stays legible as pure state.
    brand: '#ffffff', // web --color-teal-bright
    brandShimmer: '#e9e6df', // monochrome shimmer pulses DOWN, not up
    accent: '#ffffff', // alias → brand
    primary: '#16161a', // web --color-surface-2

    // ── Spinner ──────────────────────────────────────────────────────────
    spinner: '#ffffff',
    spinnerShimmer: '#e9e6df',

    // ── Prompt ───────────────────────────────────────────────────────────
    promptBorder: '#232328', // web --color-line
    promptBorderShimmer: '#605f5a', // web --color-faint

    // ── Text ─────────────────────────────────────────────────────────────
    text: '#e9e6df', // web --color-cream
    textDim: '#8c8c84', // web --color-muted (alias → subtle)
    subtle: '#8c8c84',
    faint: '#605f5a', // web --color-faint

    // ── Backgrounds ──────────────────────────────────────────────────────
    bg: '#0a0a0b', // web --color-bg
    bgAlt: '#100f12', // web --color-surface
    border: '#232328', // web --color-line
    borderSoft: '#1a1a1d', // web --color-line-soft
    userMessageBg: '#16161a', // web --color-surface-2

    // ── Mascot ───────────────────────────────────────────────────────────
    // Tabslot is one hue at two values, the same system the Refactron mark
    // uses: a solid cream square plus the same cream at 42 percent behind it.
    // See brand/README.md. These are deliberately NOT `brand`, so the mascot
    // keeps its own colour if the rest of the CLI palette ever moves.
    mascot: '#E9E6DF', // body — brand cream (no backgroundColor, avoids glitch)
    mascotSocket: '#6D6C6A', // socket — the same cream at 42% over ink #141416

    // ── Semantic states ───────────────────────────────────────────────────
    // Deliberately still hued, and the only hues left on screen. A terminal has
    // no typography to lean on, so a verdict, a severity and a diff line have to
    // separate by colour or by nothing. The website can be monochrome about this
    // because it has three type families; a scrollback buffer does not.
    //
    // Open question, not decided here: the website renders SAFE/UNSAFE/UNPROVEN
    // monochrome by brightness plus a glyph, on the argument that amber-vs-red
    // makes UNPROVEN look like a weak failure when it is not a failure at all.
    // That is a product call about how a verdict reads, not a palette clean-up.
    success: '#3fb950',
    error: '#f85149',
    warning: '#d29922',
    critical: '#ff4444',
    high: '#ff8800',
    medium: '#ffdd00',
    low: '#44cc44',
    trivial: '#8c8c84', // no severity is chrome, not information → muted

    // ── Diff ─────────────────────────────────────────────────────────────
    diffAdded: '#78bf7a',
    diffRemoved: '#f47067',
    diffAddedWord: '#3fb950',
    diffRemovedWord: '#f85149',
    diffAddedDim: '#2d4a2e',
    diffRemovedDim: '#4a1e1e',
  },

  symbols: {
    pass: '✔',
    fail: '✗',
    arrow: '→',
    bullet: '·',
    bar: '█',
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
    trivial: '#8c8c84', // matches colors.trivial: no blast radius is chrome
    low: '#44cc44',
    medium: '#ffdd00',
    high: '#ff8800',
    critical: '#ff4444',
  },

  severityColors: {
    critical: '#ff4444',
    high: '#ff8800',
    medium: '#ffdd00',
    low: '#44cc44',
  },
} as const;

export type Theme = typeof theme;
