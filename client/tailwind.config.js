/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'narrimo': {
          midnight: '#0A2342',
          sage: '#6A8A82',
          coral: '#FF6F61',
          cream: '#F7F4E9',
          silver: '#C0C0C0'
        },
        // New neutral slate palette - primary theme colors
        'slate': {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617'
        },
        // Night palette - DEPRECATED, kept for backward compatibility
        // TODO: Migrate all night-* classes to slate-* then remove
        'night': {
          50: '#f0f4ff',
          100: '#e0e8ff',
          200: '#c7d4fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#1e1b4b',
          900: '#0f0d24',
          950: '#080716'
        },
        // Accent colors
        'golden': {
          400: '#FF6F61',
          500: '#ff5a4f',
          600: '#e64b41'
        },
        // Mood accent colors for genre-adaptive theming
        'mood': {
          neutral: '#6366f1',   // Indigo - default
          fantasy: '#a855f7',   // Purple
          horror: '#dc2626',    // Red
          romance: '#ec4899',   // Pink
          scifi: '#06b6d4',     // Cyan
          mystery: '#8b5cf6',   // Violet
          adventure: '#f59e0b'  // Amber
        }
      },
      fontFamily: {
        'story': ['Merriweather', 'Georgia', 'serif'],
        'ui': ['Inter', 'system-ui', 'sans-serif'],
        'heading': ['Poppins', 'system-ui', 'sans-serif']
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'twinkle': 'twinkle 2s ease-in-out infinite',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' }
        },
        twinkle: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.3 }
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        },
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: 0 },
          '100%': { transform: 'translateX(0)', opacity: 1 }
        }
      }
    },
  },
  plugins: [],
}
