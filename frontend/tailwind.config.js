/** @type {import('tailwindcss').Config} */
import forms from "@tailwindcss/forms";
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          50:  "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
          950: "#052e16",
        },
        // Japanese corporate palette
        jp: {
          bg:     "#F5F4F0",
          dark:   "#0D0D0D",
          text:   "#2A2A2A",
          muted:  "#888888",
          accent: "#1A5C3A",
          "accent-light": "#E8F0EB",
          label:  "#BBBBBB",
        },
      },
      fontFamily: {
        sans:    ["Inter", "system-ui", "sans-serif"],
        display: ["Inter", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Japanese corporate scale
        "hero":    ["clamp(56px,8vw,112px)", { lineHeight: "0.95", fontWeight: "300", letterSpacing: "-0.03em" }],
        "section": ["clamp(36px,5vw,64px)",  { lineHeight: "1.1",  fontWeight: "300" }],
        "cta-h":   ["clamp(48px,6vw,80px)",  { lineHeight: "1.05", fontWeight: "300" }],
        // Legacy
        display: ["2.25rem", { lineHeight: "1.2", fontWeight: "800" }],
        h1: ["1.875rem", { lineHeight: "1.25", fontWeight: "700" }],
        h2: ["1.5rem",   { lineHeight: "1.3",  fontWeight: "700" }],
        h3: ["1.25rem",  { lineHeight: "1.4",  fontWeight: "600" }],
        h4: ["1.125rem", { lineHeight: "1.5",  fontWeight: "600" }],
        "body-lg": ["1rem",    { lineHeight: "1.6", fontWeight: "400" }],
        body:      ["0.875rem",{ lineHeight: "1.6", fontWeight: "400" }],
        caption:   ["0.75rem", { lineHeight: "1.5", fontWeight: "400" }],
        mono:      ["0.8125rem",{ lineHeight: "1.7", fontWeight: "400" }],
      },
      boxShadow: {
        card:       "0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
        modal:      "0 20px 60px rgba(0, 0, 0, 0.12)",
        green:      "0 4px 16px rgba(26, 92, 58, 0.20)",
        "green-lg": "0 8px 32px rgba(26, 92, 58, 0.18)",
        indigo:     "0 6px 24px rgba(99, 102, 241, 0.30)",
        "indigo-lg":"0 12px 40px rgba(99, 102, 241, 0.25)",
      },
      keyframes: {
        fadeInUp: {
          from: { transform: "translateY(12px)", opacity: "0" },
          to:   { transform: "translateY(0)",    opacity: "1" },
        },
        slideInRight: {
          from: { transform: "translateX(16px)", opacity: "0" },
          to:   { transform: "translateX(0)",    opacity: "1" },
        },
        recordingPulse: {
          "0%, 100%": { transform: "scale(1)",    opacity: "1" },
          "50%":      { transform: "scale(1.05)", opacity: "0.9" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in-up": "fadeInUp 0.3s ease-out both",
        "slide-right": "slideInRight 0.25s ease-out both",
        recording: "recordingPulse 2s ease-in-out infinite",
        shimmer:   "shimmer 2s infinite linear",
      },
      borderRadius: {
        sm:   "2px",
        DEFAULT: "2px",
        md:   "2px",
        lg:   "4px",
        xl:   "4px",
        "2xl":"4px",
        "3xl":"4px",
      },
      spacing: {
        "section": "120px",
        "section-sm": "64px",
      },
    },
  },
  plugins: [
    forms,
    typography,
  ],
};
