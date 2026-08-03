module.exports = {
  content: ["./src/app.jsx", "./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      colors: {
        banana: "#ffd86b",
        coral: "#ff7b6e",
        cream: "#fff8e7",
        ink: "#263238",
        leaf: "#2f8f5b",
        moss: "#1f6b48",
        nightglass: "rgba(17, 35, 25, 0.68)",
      },
      boxShadow: {
        glow: "0 18px 55px rgba(18, 45, 28, 0.32)",
        label: "0 12px 28px rgba(11, 32, 20, 0.28)",
      },
    },
  },
};
