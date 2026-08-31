// ═══════════════════════════════════════════════════════════════
// 紫宸石箓 — 国际化 i18n
// ═══════════════════════════════════════════════════════════════

const I18n = {
  lang: localStorage.getItem('zc-lang') || 'en',
  _cache: {},

  async load(lang) {
    this.lang = lang;
    localStorage.setItem('zc-lang', lang);
    try {
      const res = await fetch(`lang/${lang}.json`);
      this._cache[lang] = await res.json();
    } catch (e) {
      console.warn('i18n load failed, using fallback');
      this._cache[lang] = {};
    }
  },

  t(path) {
    const data = this._cache[this.lang] || {};
    return path.split('.').reduce((o, k) => o?.[k], data) || path;
  },

  toggle() {
    const next = this.lang === 'en' ? 'zh' : 'en';
    this.load(next).then(() => {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = this.t(key);
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = this.t(key);
      });
      // 更新语言按钮文字
      const langBtn = document.getElementById('lang-toggle');
      if (langBtn) langBtn.textContent = this.lang === 'en' ? '中文' : 'EN';
    });
  },

  init() {
    return this.load(this.lang).then(() => {
      const langBtn = document.getElementById('lang-toggle');
      if (langBtn) {
        langBtn.textContent = this.lang === 'en' ? '中文' : 'EN';
        langBtn.addEventListener('click', () => this.toggle());
      }
    });
  }
};
