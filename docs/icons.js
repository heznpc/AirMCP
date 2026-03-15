// Module SVG icons with Apple app brand colors
const ModIcons = (() => {
  const s = (d, color) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const icons = {
    notes: s(
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
      '#FFCC02'
    ),
    reminders: s(
      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      '#FF6723'
    ),
    calendar: s(
      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="8" y="14" width="3" height="3" rx=".5" fill="currentColor" stroke="none"/>',
      '#FF2D55'
    ),
    contacts: s(
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      '#A8A8A8'
    ),
    mail: s(
      '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
      '#1A8CFF'
    ),
    messages: s(
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      '#34C759'
    ),
    music: s(
      '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
      '#FC3C44'
    ),
    photos: s(
      '<circle cx="12" cy="13" r="4"/><path d="M5 7h1a2 2 0 0 0 2-2 1 1 0 0 1 1-1h6a1 1 0 0 1 1 1 2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2"/>',
      '#FF9F0A'
    ),
    tv: s(
      '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
      'currentColor'
    ),
    podcasts: s(
      '<path d="M12 1a7 7 0 0 0-7 7v0a7 7 0 0 0 4 6.33V21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6.67A7 7 0 0 0 19 8v0a7 7 0 0 0-7-7z"/><circle cx="12" cy="8" r="2"/>',
      '#8E4EC6'
    ),
    system: s(
      '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
      '#8E8E93'
    ),
    finder: s(
      '<path d="M4 4a2 2 0 0 1 2-2h6l2 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
      '#3A9BDC'
    ),
    safari: s(
      '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
      '#006CFF'
    ),
    screen: s(
      '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="3"/>',
      '#5856D6'
    ),
    maps: s(
      '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
      '#30D158'
    ),
    shortcuts: s(
      '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6M12 9v6"/>',
      '#FF3B82'
    ),
    intelligence: s(
      '<circle cx="12" cy="12" r="10"/><path d="M12 6v2"/><path d="M12 16v2"/><path d="M6 12h2"/><path d="M16 12h2"/><circle cx="12" cy="12" r="3"/><path d="m9.17 9.17-.71-.71M15.54 15.54l-.71-.71M9.17 14.83l-.71.71M15.54 8.46l-.71.71"/>',
      'url(#ai-grad)'
    ),
    ui: s(
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/><circle cx="7" cy="6" r=".5" fill="currentColor"/><circle cx="5" cy="6" r=".5" fill="currentColor"/>',
      '#FF9500'
    ),
    location: s(
      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
      '#FF6961'
    ),
    bluetooth: s(
      '<polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/>',
      '#007AFF'
    ),
  };

  // Intelligence uses a gradient — patch its SVG
  icons.intelligence = icons.intelligence.replace(
    '<svg ',
    '<svg ').replace(
    '</svg>',
    '<defs><linearGradient id="ai-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FF6482"/><stop offset="50%" stop-color="#A17BF0"/><stop offset="100%" stop-color="#5FC3E4"/></linearGradient></defs></svg>'
  );

  function inject() {
    document.querySelectorAll('[data-mod]').forEach(el => {
      const key = el.dataset.mod;
      if (icons[key]) el.innerHTML = icons[key];
    });
  }

  function getSvg(key) {
    return icons[key] || '';
  }

  document.addEventListener('DOMContentLoaded', inject);

  return { inject, getSvg, icons };
})();
