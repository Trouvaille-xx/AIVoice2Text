/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // 浅色基调
        bg: {
          base: '#F8F9FC',
          soft: '#EEF1F7',
        },
        // 主色调 - 静谧蓝
        primary: {
          50: '#EEF4FF',
          100: '#DCE8FF',
          200: '#B8D1FF',
          300: '#8FB3FF',
          400: '#5B8DEF',
          500: '#3B72E0',
          600: '#2A5BC0',
        },
        // 强调色 - 紫罗兰
        accent: {
          400: '#B59CFF',
          500: '#9B7EF8',
          600: '#7B5CE8',
        },
        // 状态色
        success: {
          400: '#34D399',
          500: '#10B981',
        },
        danger: {
          400: '#F87171',
          500: '#EF4444',
        },
        ink: {
          900: '#1A1D29',
          700: '#374151',
          500: '#6B7280',
          300: '#9CA3AF',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'PingFang SC',
          'Microsoft YaHei UI',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        glass: '24px',
        bubble: '20px',
      },
      boxShadow: {
        glass:
          '0 8px 32px rgba(60, 80, 120, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
        'glass-lg':
          '0 20px 60px rgba(60, 80, 120, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
        'glass-sm':
          '0 4px 16px rgba(60, 80, 120, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
        'primary-glow': '0 0 24px rgba(91, 141, 239, 0.45)',
        'accent-glow': '0 0 24px rgba(155, 126, 248, 0.45)',
      },
      backdropBlur: {
        glass: '40px',
      },
      animation: {
        breathe: 'breathe 3s ease-in-out infinite',
        'pulse-ring': 'pulseRing 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'voice-bar': 'voiceBar 1.1s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        'fade-in-up': 'fadeInUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) both',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.95' },
          '50%': { transform: 'scale(1.02)', opacity: '1' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        voiceBar: {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      transitionTimingFunction: {
        'soft-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
