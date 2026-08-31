// ═══════════════════════════════════════════════════════════════
// 紫宸石箓 — 公共逻辑
// ═══════════════════════════════════════════════════════════════

// ── 购物车 ──────────────────────────
const Cart = {
  _key: 'zc-cart',

  get() {
    try { return JSON.parse(localStorage.getItem(this._key)) || []; }
    catch { return []; }
  },

  add(item) {
    const cart = this.get();
    const existing = cart.find(c => c.id === item.id && c.type === item.type);
    if (existing) {
      existing.qty += item.qty || 1;
    } else {
      cart.push({ ...item, qty: item.qty || 1 });
    }
    localStorage.setItem(this._key, JSON.stringify(cart));
    this._updateBadge();
  },

  remove(id, type) {
    const cart = this.get().filter(c => !(c.id === id && c.type === type));
    localStorage.setItem(this._key, JSON.stringify(cart));
    this._updateBadge();
  },

  clear() {
    localStorage.removeItem(this._key);
    this._updateBadge();
  },

  total() {
    return this.get().reduce((sum, item) => sum + item.price * item.qty, 0);
  },

  count() {
    return this.get().reduce((sum, item) => sum + item.qty, 0);
  },

  _updateBadge() {
    const badge = document.getElementById('cart-badge');
    if (badge) {
      const n = this.count();
      badge.textContent = n;
      badge.style.display = n > 0 ? 'flex' : 'none';
    }
  }
};

// ── 工具函数 ──────────────────────────
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function formatPrice(price) {
  return `$${price.toFixed(2)}`;
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function showToast(msg, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-full text-sm font-medium';
  toast.style.cssText = 'background:rgba(26,20,16,0.92);color:#FAF7F2;border:1px solid rgba(201,162,75,0.3);backdrop-filter:blur(12px);animation:fade-in 0.3s ease;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, duration);
  setTimeout(() => toast.remove(), duration + 300);
}

// ── Tab 栏高亮 ──────────────────────────
function initTabBar(activeTab) {
  const tabs = $$('.zc-tab-item');
  tabs.forEach(tab => {
    if (tab.dataset.tab === activeTab) tab.classList.add('active');
    tab.addEventListener('click', () => {
      const page = tab.dataset.tab;
      if (page) window.location.href = page;
    });
  });
  Cart._updateBadge();
}

// ── 返回顶部 ──────────────────────────
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
