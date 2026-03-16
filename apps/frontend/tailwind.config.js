/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page:    "#0a0a0b",
        panel:   "#16161a",
        raised:  "#1c1c21",
        border:  "#1f1f26",
        "border-strong": "#2a2a35",
        buy:     "#00c87a",
        sell:    "#f0364a",
        accent:  "#7c6df0",
        "text-primary":   "#e8e8f0",
        "text-secondary": "#9090a8",
        "text-muted":     "#55556a",
        "pm-color":  "#a78bfa",
        "ks-color":  "#22d3ee",
      },
    },
  },
  plugins: [],
};
