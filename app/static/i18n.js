/* Gibson's Broadband Monitor: self-hosted, dependency-free interface translations. */
(() => {
  'use strict';
  const options = [
    ['en','English'], ['fr','Français'], ['de','Deutsch'],
    ['es','Español'], ['it','Italiano'], ['nl','Nederlands'],
    ['pt','Português'], ['pl','Polski'], ['ja','日本語'],
    ['zh-CN','简体中文'], ['zh-TW','繁體中文'], ['sv','Svenska'],
    ['ko','한국어'], ['ar','العربية'], ['da','Dansk'], ['nb','Norsk']
  ];
  const supported = new Set(options.map(([code]) => code));
  const storeKey = 'gbm-language';
  const stored = (() => { try { return localStorage.getItem(storeKey); } catch { return null; } })();

  function normalise(input) {
    if (!input) return null;
    const name = String(input).replace(/_/g, '-').toLowerCase();
    if (name.startsWith('zh')) return /(?:-tw|-hk|-mo|-hant)/.test(name) ? 'zh-TW' : 'zh-CN';
    if (name === 'no' || name.startsWith('no-') || name.startsWith('nb')) return 'nb';
    if (name.startsWith('pt')) return 'pt';
    const base = name.split('-')[0];
    return supported.has(base) ? base : null;
  }
  const preferred = () => {
    for (const name of navigator.languages || [navigator.language || 'en']) {
      const language = normalise(name);
      if (language) return language;
    }
    return 'en';
  };
  const selected = stored && supported.has(stored) ? stored : null;
  const code = selected || preferred();
  let strings = {};
  let ready = null;
  const originalText = new WeakMap();
  function t(english, args = {}) {
    const text = strings[english] || english;
    return text.replace(/\{([a-z]+)\}/gi, (match, key) =>
      Object.prototype.hasOwnProperty.call(args, key) ? String(args[key]) : match);
  }
  function translatePage(root = document.body) {
    if (!root) return;
    document.documentElement.lang = code;
    document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('script,style,code,pre,option')) continue;
      const raw = originalText.get(node) ?? node.nodeValue;
      originalText.set(node, raw);
      const key = raw.trim();
      if (!key || !(key in strings)) continue;
      const before = raw.slice(0, raw.indexOf(key));
      const after = raw.slice(raw.indexOf(key) + key.length);
      node.nodeValue = before + t(key) + after;
    }
    for (const el of root.querySelectorAll('[placeholder],[aria-label],[title]')) {
      for (const attribute of ['placeholder','aria-label','title']) {
        const value = el.getAttribute(attribute);
        if (value && strings[value]) el.setAttribute(attribute, t(value));
      }
    }
    if (document.title.startsWith('Sign in')) {
      document.title = t('Sign in') + ' · Gibson\'s Broadband Monitor';
    }
  }
  function setupSelector() {
    const selector = document.getElementById('language-select');
    if (!selector) return;
    selector.replaceChildren();
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = t('Automatically (browser language)');
    selector.append(auto);
    for (const [value, name] of options) {
      const entry = document.createElement('option');
      entry.value = value;
      entry.textContent = name;
      selector.append(entry);
    }
    selector.value = selected || 'auto';
    selector.addEventListener('change', () => {
      try {
        if (selector.value === 'auto') localStorage.removeItem(storeKey);
        else localStorage.setItem(storeKey, selector.value);
      } catch { /* Browsers with storage disabled can still use default language. */ }
      location.reload();
    });
  }
  async function init() {
    if (ready) return ready;
    ready = (async () => {
      if (code !== 'en') {
        try {
          const response = await fetch('/static/locales/' + encodeURIComponent(code) + '.json');
          if (!response.ok) throw Error('HTTP ' + response.status);
          const data = await response.json();
          if (data && typeof data === 'object' && !Array.isArray(data)) strings = data;
        } catch (error) {
          console.warn('Translation unavailable; falling back to English.', error);
        }
      }
      translatePage();
      setupSelector();
    })();
    return ready;
  }
  window.GBM_I18N = { init, t, translatePage, code, locale: code, options };
  document.addEventListener('DOMContentLoaded', () => { void init(); });
})();
