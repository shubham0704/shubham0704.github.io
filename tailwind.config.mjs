/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#e2622a', // Ember orange
          hover: '#ef7a45'
        },
        background: {
          dark: '#17150f',  // Warm near-black
          light: '#ffffff'
        }
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}