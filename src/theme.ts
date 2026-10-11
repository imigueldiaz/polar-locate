export const theme = {
  colors: {
    bg: '#000000',
    panel: 'rgba(24, 0, 3, 0.82)',
    red: '#c1121f',
    redBright: '#ff2b3a',
    redDim: '#7a0b13',
    line: '#5c0d14',
    text: '#d64b52',
    textDim: '#8a3a3f',
    on: '#ff2b3a',
    off: '#4a0a10',
    // Dim on purpose: star labels must not hurt dark adaptation.
    green: '#37734a',
  },
  mono: 'monospace',
  space: (n: number) => n * 8,
};

export type Theme = typeof theme;
