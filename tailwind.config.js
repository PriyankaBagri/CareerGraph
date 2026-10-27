/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { ink: '#171311', panel: '#221c18', line: '#3a302a', mute: '#a89b8e', ember: '#e0813f', cream: '#faf6ef', sand: '#e6dccd', bark: '#2a221c', bark2: '#6b5d51', ok: '#3f8f5f', warn: '#c98a1b', bad: '#b8452f' },
    borderRadius: { card: '18px' },
    keyframes: { rise: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } } },
    animation: { rise: 'rise .35s ease-out both' },
  } },
  plugins: [],
};
