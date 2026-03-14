const I18n = (() => {
  const STORAGE_KEY = 'iconnect-lang';
  const SUPPORTED = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt'];
  let locale = {};
  let currentLang = 'en';

  function detect() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
    const nav = (navigator.language || '').toLowerCase();
    if (nav === 'zh-cn' || nav === 'zh-hans' || nav.startsWith('zh-hans')) return 'zh-CN';
    if (nav.startsWith('zh')) return 'zh-TW';
    if (nav.startsWith('ko')) return 'ko';
    if (nav.startsWith('ja')) return 'ja';
    if (nav.startsWith('es')) return 'es';
    if (nav.startsWith('fr')) return 'fr';
    if (nav.startsWith('de')) return 'de';
    if (nav.startsWith('pt')) return 'pt';
    return 'en';
  }

  async function load(lang) {
    const res = await fetch(`locales/${lang}.json`);
    if (!res.ok) throw new Error(`Failed to load ${lang}`);
    return res.json();
  }

  function apply(data) {
    locale = data;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (data[key] == null) return;

      if (el.hasAttribute('data-i18n-attr')) {
        el.setAttribute(el.getAttribute('data-i18n-attr'), data[key]);
      } else if (el.tagName === 'TITLE') {
        document.title = data[key];
      } else if (data[key].includes('\n')) {
        el.innerHTML = data[key].split('\n').map(s => s.replace(/</g, '&lt;')).join('<br>');
      } else {
        el.textContent = data[key];
      }
    });

    document.documentElement.lang = currentLang;
    document.dispatchEvent(new CustomEvent('langchange', { detail: currentLang }));
  }

  async function init() {
    currentLang = detect();
    const data = await load(currentLang);
    apply(data);
  }

  async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    const data = await load(lang);
    apply(data);
  }

  function get(key) { return locale[key] || key; }
  function lang() { return currentLang; }
  function languages() { return SUPPORTED; }

  return { init, setLang, get, lang, languages };
})();

I18n.init();
