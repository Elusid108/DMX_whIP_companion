module.exports = {
  content: ["./src/**/*.{html,js}"],
  theme: {
    extend: {
      gridTemplateColumns: {
        // Adding custom grid column configurations
        '16': 'repeat(16, minmax(0, 1fr))',
        '32': 'repeat(32, minmax(0, 1fr))',
      },
    },
  },
  plugins: [],
}