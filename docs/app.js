// === Theme toggle ===
const THEME_KEY = 'airmcp-theme';
const themeToggle = document.getElementById('themeToggle');
const themeIcon = themeToggle.querySelector('.theme-icon');

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeIcon.textContent = t === 'dark' ? '\u2600' : '\u263E';
  localStorage.setItem(THEME_KEY, t);
}
setTheme(localStorage.getItem(THEME_KEY) || 'dark');
themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// === Language dropdown ===
const langDropdown = document.getElementById('langDropdown');
const langToggleBtn = document.getElementById('langToggle');

langToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  langDropdown.classList.toggle('open');
});

langDropdown.querySelectorAll('[data-lang]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    I18n.setLang(btn.dataset.lang);
    langDropdown.classList.remove('open');
  });
});

document.addEventListener('click', () => langDropdown.classList.remove('open'));

document.addEventListener('langchange', (e) => {
  const lang = e.detail;
  langDropdown.querySelectorAll('[data-lang]').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
});

// === Mobile nav ===
const mobileToggle = document.getElementById('mobileToggle');
const navLinks = document.getElementById('navLinks');
mobileToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => navLinks.classList.remove('open'))
);

// === Filter module cards ===
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const cards = document.querySelectorAll('#moduleGrid .glass-card');
    cards.forEach(c => {
      if (!c.classList.contains('hidden')) {
        c.style.opacity = '0';
        c.style.transform = 'translateY(8px)';
      }
    });

    setTimeout(() => {
      cards.forEach(c => {
        const match = f === 'all' || c.dataset.category === f;
        c.classList.toggle('hidden', !match);
        void c.offsetWidth;
        if (match) {
          c.style.opacity = '1';
          c.style.transform = 'none';
        }
      });
    }, 200);
  });
});

// === Modal for module details ===
const modal = document.getElementById('modal');
const modalIcon = document.getElementById('modalIcon');
const modalTitle = document.getElementById('modalTitle');
const modalDetail = document.getElementById('modalDetail');
const modalTags = document.getElementById('modalTags');

document.querySelectorAll('#moduleGrid .glass-card[data-detail]').forEach(card => {
  card.addEventListener('click', () => {
    modalIcon.textContent = card.dataset.icon || '';
    modalTitle.textContent = card.querySelector('.card-title').textContent;
    modalDetail.textContent = I18n.get(card.dataset.detail);
    modalTags.textContent = card.querySelector('.card-tags').textContent;
    modal.classList.add('open');
  });
});

document.getElementById('modalClose').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.remove('open');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') modal.classList.remove('open');
});

// === Scroll reveal with stagger ===
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const delay = parseInt(entry.target.dataset.delay || '0', 10);
    setTimeout(() => entry.target.classList.add('visible'), delay);
    io.unobserve(entry.target);
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
