import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Sora'", "sans-serif"],
        body: ["'DM Sans'", "sans-serif"],
      },
      colors: {
        brand: {
          50:  "#fff8e7",
          100: "#ffedb8",
          200: "#ffe08a",
          300: "#ffd25c",
          400: "#ffc52e",
          500: "#ffb800",
          600: "#cc9200",
          700: "#996d00",
          800: "#664900",
          900: "#332400",
        },
        emerald: {
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
        surface: {
          base: "#0f0f14",
          card: "#17171f",
          elevated: "#1e1e28",
          border: "#2a2a38",
        },
      },
      animation: {
        "xp-fill": "xpFill 0.6s ease-out forwards",
        "float-up": "floatUp 0.8s ease-out forwards",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        "streak-fire": "streakFire 1.5s ease-in-out infinite",
        "badge-pop": "badgePop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        "confetti-fall": "confettiFall 1s ease-out forwards",
        "shimmer": "shimmer 2s linear infinite",
      },
      keyframes: {
        xpFill: {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        floatUp: {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-60px)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 8px rgba(255,184,0,0.3)" },
          "50%": { boxShadow: "0 0 24px rgba(255,184,0,0.7)" },
        },
        streakFire: {
          "0%, 100%": { transform: "scale(1) rotate(-2deg)" },
          "50%": { transform: "scale(1.1) rotate(2deg)" },
        },
        badgePop: {
          "0%": { transform: "scale(0) rotate(-10deg)", opacity: "0" },
          "100%": { transform: "scale(1) rotate(0deg)", opacity: "1" },
        },
        confettiFall: {
          "0%": { transform: "translateY(-20px) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateY(100px) rotate(720deg)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
