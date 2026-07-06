/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        espresso: {
          DEFAULT: '#2E1A11',
          light: '#5D4037',
          dark: '#1C0F0A',
          cream: '#8D6E63',
        },
        gold: {
          DEFAULT: '#D4AF37',
          light: '#F3E5AB',
          dark: '#AA7C11',
        },
        cream: {
          DEFAULT: '#FDFBF7',
          dark: '#F5ECE1',
        },
        charcoal: {
          DEFAULT: '#2A2A2A',
          light: '#4A4A4A',
          dark: '#121212',
        }
      },
      fontFamily: {
        serif: ['Poppins', 'sans-serif'],
        sans: ['Poppins', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
