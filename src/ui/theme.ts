// src/ui/theme.ts
export const theme = {
  colors: {
    primary: '#1e3a5f',
    accent: '#4a9eff',
    critical: '#ff4444',
    high: '#ff8800',
    medium: '#ffdd00',
    low: '#44cc44',
    trivial: '#888888',
    text: '#e8e8e8',
    textDim: '#888888',
    bg: '#0d1117',
    bgAlt: '#161b22',
    border: '#30363d',
    success: '#3fb950',
    error: '#f85149',
    warning: '#d29922',
  },
  symbols: {
    pass: '✔',
    fail: '✗',
    arrow: '→',
    bullet: '·',
    bar: '█',
    barEmpty: '░',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  },
  blastColors: {
    trivial: '#888888',
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
