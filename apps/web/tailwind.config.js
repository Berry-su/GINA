/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./**/*.html",
    "./crystal-mall/**/*.html",
    "./crystal-mall/**/*.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        'fira': ['"Fira Code"', 'monospace'],
        'inter': ['Inter', 'sans-serif'],
        'display': ['"PingFang SC"', '"Noto Serif SC"', 'serif'],
        'body': ['Inter', '"PingFang SC"', 'sans-serif'],
      },
      colors: {
        // 紫宸石箓 品牌色
        zc: {
          purple: '#8B6FD4',
          'purple-soft': '#B8A4E8',
          'purple-deep': '#6B4FB8',
          gold: '#C9A24B',
          'gold-soft': '#E8D5A0',
          'gold-deep': '#A87F2E',
          // 背景
          'bg-dark': '#1A1410',
          'bg-darker': '#0F0C08',
          'bg-card': 'rgba(26,20,16,0.85)',
          'bg-cream': '#FAF7F2',
          'bg-cream-2': '#F5F0E8',
          // 文字
          text: '#FAF7F2',
          'text-2': '#A09888',
          'text-3': '#6B6058',
          'text-dark': '#1A1410',
          // 边框
          border: 'rgba(160,152,136,0.2)',
          'border-gold': 'rgba(201,162,75,0.3)',
        },
        // Gina 青绿
        gina: {
          cyan: '#3fd6c8',
          'cyan-soft': '#7AE8DD',
        },
      },
      borderRadius: {
        'zc': '12px',
        'zc-lg': '20px',
        'zc-xl': '28px',
      },
      boxShadow: {
        'zc': '0 4px 24px rgba(0,0,0,0.3)',
        'zc-glow': '0 0 20px rgba(139,111,212,0.3)',
        'zc-gold': '0 0 16px rgba(201,162,75,0.25)',
      },
    },
  },
  plugins: [],
}
