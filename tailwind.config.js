// Theme colours come from the CSS variables in src/renderer/input.css so
// light / dark switch by class and canvases can read the same values.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const TOKENS = [
  'app', 'panel', 'surface', 'sunken', 'well', 'input', 'hover', 'selected', 'selected-line',
  'line', 'edge', 'edge-hover',
  'fg', 'fg-strong', 'fg-soft', 'muted', 'faint',
  'accent', 'accent-hover', 'on-accent', 'mark',
  'danger', 'ok', 'warn', 'artnet', 'sacn', 'ink'
];

module.exports = {
  darkMode: 'class',
  content: [
    "./src/renderer/**/*.{html,js}",
    "!./src/renderer/generated/**"
  ],
  theme: {
    extend: {
      colors: Object.fromEntries(TOKENS.map((name) => [name, token(name)])),
      borderRadius: {
        'ui-sm': 'var(--radius-sm)',
        ui: 'var(--radius)',
        'ui-lg': 'var(--radius-lg)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      gridTemplateColumns: {
        '16': 'repeat(16, minmax(0, 1fr))',
        '32': 'repeat(32, minmax(0, 1fr))',
      },
    },
  },
  plugins: [],
}
