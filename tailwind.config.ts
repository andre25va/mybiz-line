import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#f5f5f7',
        card:    '#ffffff',
        border:  '#e5e7eb',
        accent:  '#2563eb',
        danger:  '#dc2626',
        muted:   '#9ca3af',
        text:    '#111827',
        subtext: '#6b7280',
      },
    },
  },
  plugins: [],
};
export default config;
