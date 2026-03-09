/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          light: '#FF6B9D',
          dark: '#5B8DEF',
        },
        accent: '#5B8DEF',
        background: '#0a0a0c',
        card: 'rgba(255, 255, 255, 0.05)',
      },
      backgroundImage: {
        'tech-gradient': 'linear-gradient(135deg, #FF6B9D 0%, #5B8DEF 100%)',
      },
      boxShadow: {
        'neon': '0 0 10px rgba(91, 141, 239, 0.5), 0 0 20px rgba(91, 141, 239, 0.3)',
      },
    },
  },
  plugins: [],
}
