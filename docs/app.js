// === Theme toggle ===
const THEME_KEY = 'airmcp-theme';
const themeToggle = document.getElementById('themeToggle');
const themeIcon = themeToggle.querySelector('.theme-icon');

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeIcon.textContent = t === 'dark' ? '\u2600' : '\u263E';
  localStorage.setItem(THEME_KEY, t);
}
setTheme(localStorage.getItem(THEME_KEY) || 'light');
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

// === Module data (tools + examples) ===
const MOD_DATA = {
  notes: {
    tools: [
      { name: 'list_notes', desc: 'List all notes', type: 'read' },
      { name: 'search_notes', desc: 'Search by keyword', type: 'read' },
      { name: 'read_note', desc: 'Read full content', type: 'read' },
      { name: 'create_note', desc: 'Create with HTML body', type: 'write' },
      { name: 'update_note', desc: 'Replace body', type: 'destructive' },
      { name: 'delete_note', desc: 'Delete note', type: 'destructive' },
      { name: 'move_note', desc: 'Move to folder', type: 'destructive' },
      { name: 'list_folders', desc: 'List folders', type: 'read' },
      { name: 'create_folder', desc: 'Create folder', type: 'write' },
      { name: 'scan_notes', desc: 'Bulk scan with preview', type: 'read' },
      { name: 'compare_notes', desc: 'Compare 2-5 notes', type: 'read' },
      { name: 'bulk_move_notes', desc: 'Move multiple notes', type: 'destructive' },
    ],
  },
  reminders: {
    tools: [
      { name: 'list_reminder_lists', desc: 'List all lists', type: 'read' },
      { name: 'list_reminders', desc: 'Filter by list/completed', type: 'read' },
      { name: 'read_reminder', desc: 'Full details', type: 'read' },
      { name: 'create_reminder', desc: 'Create with due date', type: 'write' },
      { name: 'update_reminder', desc: 'Update properties', type: 'destructive' },
      { name: 'complete_reminder', desc: 'Mark complete', type: 'write' },
      { name: 'delete_reminder', desc: 'Delete', type: 'destructive' },
      { name: 'search_reminders', desc: 'Search by keyword', type: 'read' },
      { name: 'create_reminder_list', desc: 'Create list', type: 'write' },
      { name: 'delete_reminder_list', desc: 'Delete list', type: 'destructive' },
      { name: 'create_recurring_reminder', desc: 'Recurring (EventKit)', type: 'write' },
    ],
  },
  calendar: {
    tools: [
      { name: 'list_calendars', desc: 'List calendars', type: 'read' },
      { name: 'list_events', desc: 'Events in date range', type: 'read' },
      { name: 'read_event', desc: 'Full details', type: 'read' },
      { name: 'create_event', desc: 'Create event', type: 'write' },
      { name: 'update_event', desc: 'Update event', type: 'destructive' },
      { name: 'delete_event', desc: 'Delete event', type: 'destructive' },
      { name: 'search_events', desc: 'Search by keyword', type: 'read' },
      { name: 'get_upcoming_events', desc: 'Next N events', type: 'read' },
      { name: 'today_events', desc: "Today's events", type: 'read' },
      { name: 'create_recurring_event', desc: 'Recurring (EventKit)', type: 'write' },
    ],
  },
  contacts: {
    tools: [
      { name: 'list_contacts', desc: 'List with pagination', type: 'read' },
      { name: 'search_contacts', desc: 'Search by name/email/phone', type: 'read' },
      { name: 'read_contact', desc: 'Full details', type: 'read' },
      { name: 'create_contact', desc: 'Create contact', type: 'write' },
      { name: 'update_contact', desc: 'Update contact', type: 'destructive' },
      { name: 'delete_contact', desc: 'Delete contact', type: 'destructive' },
      { name: 'list_groups', desc: 'List groups', type: 'read' },
      { name: 'add_contact_email', desc: 'Add email', type: 'write' },
      { name: 'add_contact_phone', desc: 'Add phone', type: 'write' },
      { name: 'list_group_members', desc: 'Group members', type: 'read' },
    ],
  },
  mail: {
    tools: [
      { name: 'list_mailboxes', desc: 'List mailboxes', type: 'read' },
      { name: 'list_messages', desc: 'Recent messages', type: 'read' },
      { name: 'read_message', desc: 'Full content', type: 'read' },
      { name: 'search_messages', desc: 'Search messages', type: 'read' },
      { name: 'mark_message_read', desc: 'Mark read/unread', type: 'write' },
      { name: 'flag_message', desc: 'Flag/unflag', type: 'write' },
      { name: 'get_unread_count', desc: 'Unread count', type: 'read' },
      { name: 'move_message', desc: 'Move to mailbox', type: 'destructive' },
      { name: 'list_accounts', desc: 'List accounts', type: 'read' },
      { name: 'send_mail', desc: 'Send email', type: 'write' },
      { name: 'reply_mail', desc: 'Reply to email', type: 'write' },
    ],
  },
  messages: {
    tools: [
      { name: 'list_chats', desc: 'Recent conversations', type: 'read' },
      { name: 'read_chat', desc: 'Chat details', type: 'read' },
      { name: 'search_chats', desc: 'Search chats', type: 'read' },
      { name: 'send_message', desc: 'Send iMessage/SMS', type: 'write' },
      { name: 'send_file', desc: 'Send file', type: 'write' },
      { name: 'list_participants', desc: 'Chat participants', type: 'read' },
    ],
  },
  music: {
    tools: [
      { name: 'list_playlists', desc: 'List playlists', type: 'read' },
      { name: 'list_tracks', desc: 'Tracks in playlist', type: 'read' },
      { name: 'now_playing', desc: 'Current track', type: 'read' },
      { name: 'playback_control', desc: 'Play/pause/next/prev', type: 'write' },
      { name: 'search_tracks', desc: 'Search tracks', type: 'read' },
      { name: 'play_track', desc: 'Play specific track', type: 'write' },
      { name: 'play_playlist', desc: 'Play playlist', type: 'write' },
      { name: 'get_track_info', desc: 'Track metadata', type: 'read' },
      { name: 'set_shuffle', desc: 'Shuffle/repeat', type: 'write' },
      { name: 'create_playlist', desc: 'Create playlist', type: 'write' },
      { name: 'add_to_playlist', desc: 'Add track', type: 'write' },
      { name: 'remove_from_playlist', desc: 'Remove track', type: 'destructive' },
      { name: 'delete_playlist', desc: 'Delete playlist', type: 'destructive' },
      { name: 'get_rating', desc: 'Get rating', type: 'read' },
      { name: 'set_rating', desc: 'Set rating', type: 'write' },
      { name: 'set_favorited', desc: 'Favorite', type: 'write' },
      { name: 'set_disliked', desc: 'Dislike', type: 'write' },
    ],
  },
  photos: {
    tools: [
      { name: 'list_albums', desc: 'List albums', type: 'read' },
      { name: 'list_photos', desc: 'Photos in album', type: 'read' },
      { name: 'search_photos', desc: 'Search photos', type: 'read' },
      { name: 'get_photo_info', desc: 'Photo metadata', type: 'read' },
      { name: 'list_favorites', desc: 'Favorite photos', type: 'read' },
      { name: 'create_album', desc: 'Create album', type: 'write' },
      { name: 'add_to_album', desc: 'Add to album', type: 'write' },
      { name: 'import_photo', desc: 'Import photo', type: 'write' },
      { name: 'delete_photos', desc: 'Delete photos', type: 'destructive' },
    ],
  },
  tv: {
    tools: [
      { name: 'tv_list_playlists', desc: 'List playlists', type: 'read' },
      { name: 'tv_list_tracks', desc: 'Movies/episodes', type: 'read' },
      { name: 'tv_now_playing', desc: 'Now playing', type: 'read' },
      { name: 'tv_playback_control', desc: 'Play/pause/next/prev', type: 'write' },
      { name: 'tv_search', desc: 'Search content', type: 'read' },
      { name: 'tv_play', desc: 'Play content', type: 'write' },
    ],
  },
  podcasts: {
    tools: [
      { name: 'list_podcast_shows', desc: 'List shows', type: 'read' },
      { name: 'list_podcast_episodes', desc: 'List episodes', type: 'read' },
      { name: 'podcast_now_playing', desc: 'Now playing', type: 'read' },
      { name: 'podcast_playback_control', desc: 'Play/pause', type: 'write' },
      { name: 'play_podcast_episode', desc: 'Play episode', type: 'write' },
      { name: 'search_podcast_episodes', desc: 'Search', type: 'read' },
    ],
  },
  system: {
    tools: [
      { name: 'get_clipboard', desc: 'Read clipboard', type: 'read' },
      { name: 'set_clipboard', desc: 'Write clipboard', type: 'write' },
      { name: 'get_volume', desc: 'Get volume', type: 'read' },
      { name: 'set_volume', desc: 'Set volume', type: 'write' },
      { name: 'toggle_dark_mode', desc: 'Dark/light mode', type: 'write' },
      { name: 'get_frontmost_app', desc: 'Active app', type: 'read' },
      { name: 'list_running_apps', desc: 'Running apps', type: 'read' },
      { name: 'get_screen_info', desc: 'Display info', type: 'read' },
      { name: 'show_notification', desc: 'Show notification', type: 'write' },
      { name: 'capture_screenshot', desc: 'Screenshot', type: 'write' },
      { name: 'get_wifi_status', desc: 'WiFi status', type: 'read' },
      { name: 'toggle_wifi', desc: 'Toggle WiFi', type: 'write' },
      { name: 'list_bluetooth_devices', desc: 'BT devices', type: 'read' },
      { name: 'get_battery_status', desc: 'Battery info', type: 'read' },
      { name: 'get_brightness', desc: 'Get brightness', type: 'read' },
      { name: 'set_brightness', desc: 'Set brightness', type: 'write' },
      { name: 'toggle_focus_mode', desc: 'Do Not Disturb', type: 'write' },
      { name: 'launch_app', desc: 'Launch app', type: 'write' },
      { name: 'quit_app', desc: 'Quit app', type: 'destructive' },
      { name: 'is_app_running', desc: 'Check app', type: 'read' },
      { name: 'list_all_windows', desc: 'List windows', type: 'read' },
      { name: 'move_window', desc: 'Move window', type: 'write' },
      { name: 'resize_window', desc: 'Resize window', type: 'write' },
      { name: 'minimize_window', desc: 'Minimize', type: 'write' },
    ],
  },
  finder: {
    tools: [
      { name: 'search_files', desc: 'Spotlight search', type: 'read' },
      { name: 'get_file_info', desc: 'File info', type: 'read' },
      { name: 'set_file_tags', desc: 'Set tags', type: 'destructive' },
      { name: 'recent_files', desc: 'Recent files', type: 'read' },
      { name: 'list_directory', desc: 'List directory', type: 'read' },
      { name: 'move_file', desc: 'Move/rename', type: 'destructive' },
      { name: 'trash_file', desc: 'Trash file', type: 'destructive' },
      { name: 'create_directory', desc: 'Create directory', type: 'write' },
    ],
  },
  safari: {
    tools: [
      { name: 'list_tabs', desc: 'List all tabs', type: 'read' },
      { name: 'read_page_content', desc: 'Read page text', type: 'read' },
      { name: 'get_current_tab', desc: 'Current tab', type: 'read' },
      { name: 'open_url', desc: 'Open URL', type: 'write' },
      { name: 'close_tab', desc: 'Close tab', type: 'destructive' },
      { name: 'activate_tab', desc: 'Switch tab', type: 'write' },
      { name: 'run_javascript', desc: 'Execute JS', type: 'write' },
      { name: 'search_tabs', desc: 'Search tabs', type: 'read' },
      { name: 'list_bookmarks', desc: 'List bookmarks', type: 'read' },
      { name: 'add_bookmark', desc: 'Add bookmark', type: 'write' },
      { name: 'list_reading_list', desc: 'Reading list', type: 'read' },
      { name: 'add_to_reading_list', desc: 'Add to list', type: 'write' },
    ],
  },
  screen: {
    tools: [
      { name: 'capture_screen', desc: 'Full screenshot', type: 'read' },
      { name: 'capture_window', desc: 'Window capture', type: 'read' },
      { name: 'capture_area', desc: 'Region capture', type: 'read' },
      { name: 'list_windows', desc: 'List windows', type: 'read' },
      { name: 'record_screen', desc: 'Record 1-60s', type: 'write' },
    ],
  },
  maps: {
    tools: [
      { name: 'search_location', desc: 'Search place', type: 'write' },
      { name: 'get_directions', desc: 'Get directions', type: 'write' },
      { name: 'drop_pin', desc: 'Drop pin', type: 'write' },
      { name: 'open_address', desc: 'Open address', type: 'write' },
      { name: 'search_nearby', desc: 'Nearby places', type: 'write' },
      { name: 'share_location', desc: 'Share link', type: 'read' },
      { name: 'geocode', desc: 'Address to coords', type: 'read' },
      { name: 'reverse_geocode', desc: 'Coords to address', type: 'read' },
    ],
  },
  location: {
    tools: [
      { name: 'get_current_location', desc: 'GPS coordinates', type: 'read' },
      { name: 'get_location_permission', desc: 'Permission status', type: 'read' },
    ],
  },
  bluetooth: {
    tools: [
      { name: 'get_bluetooth_state', desc: 'BT power state', type: 'read' },
      { name: 'scan_bluetooth', desc: 'Scan BLE', type: 'read' },
      { name: 'connect_bluetooth', desc: 'Connect BLE', type: 'write' },
      { name: 'disconnect_bluetooth', desc: 'Disconnect', type: 'write' },
    ],
  },
  shortcuts: {
    tools: [
      { name: 'list_shortcuts', desc: 'List shortcuts', type: 'read' },
      { name: 'run_shortcut', desc: 'Run by name', type: 'write' },
      { name: 'search_shortcuts', desc: 'Search', type: 'read' },
      { name: 'get_shortcut_detail', desc: 'Details', type: 'read' },
      { name: 'create_shortcut', desc: 'Create', type: 'write' },
      { name: 'delete_shortcut', desc: 'Delete', type: 'destructive' },
      { name: 'export_shortcut', desc: 'Export .shortcut', type: 'write' },
      { name: 'import_shortcut', desc: 'Import .shortcut', type: 'write' },
      { name: 'edit_shortcut', desc: 'Open editor', type: 'write' },
      { name: 'duplicate_shortcut', desc: 'Duplicate', type: 'write' },
    ],
  },
  intelligence: {
    tools: [
      { name: 'summarize_text', desc: 'Summarize', type: 'read' },
      { name: 'rewrite_text', desc: 'Rewrite with tone', type: 'read' },
      { name: 'proofread_text', desc: 'Grammar check', type: 'read' },
      { name: 'generate_text', desc: 'Generate text', type: 'read' },
      { name: 'generate_structured', desc: 'JSON output', type: 'read' },
      { name: 'tag_content', desc: 'Classify/tag', type: 'read' },
      { name: 'ai_chat', desc: 'On-device chat', type: 'read' },
      { name: 'ai_status', desc: 'Check availability', type: 'read' },
    ],
  },
  ui: {
    tools: [
      { name: 'ui_open_app', desc: 'Open + read UI', type: 'read' },
      { name: 'ui_click', desc: 'Click element', type: 'write' },
      { name: 'ui_type', desc: 'Type text', type: 'write' },
      { name: 'ui_press_key', desc: 'Key combo', type: 'write' },
      { name: 'ui_scroll', desc: 'Scroll', type: 'write' },
      { name: 'ui_read', desc: 'Read UI tree', type: 'read' },
    ],
  },
};

// === Modal for module details ===
const modal = document.getElementById('modal');
const modalIcon = document.getElementById('modalIcon');
const modalTitle = document.getElementById('modalTitle');
const modalDetail = document.getElementById('modalDetail');
const modalTags = document.getElementById('modalTags');
const modalPrompt = document.getElementById('modalPrompt');
const modalExample = document.getElementById('modalExample');
const modalToolGrid = document.getElementById('modalToolGrid');
const modalToolsSection = document.getElementById('modalTools');

function renderModal(modKey, card) {
  modalIcon.innerHTML = modKey ? ModIcons.getSvg(modKey) : '';
  modalTitle.textContent = card.querySelector('.card-title').textContent;
  modalDetail.textContent = I18n.get(card.dataset.detail);
  modalTags.textContent = card.querySelector('.card-tags').textContent;

  // Example prompt
  const exKey = `modal_ex_${modKey}`;
  const ex = I18n.get(exKey);
  if (ex && ex !== exKey) {
    modalPrompt.textContent = ex;
    modalExample.style.display = '';
  } else {
    modalExample.style.display = 'none';
  }

  // Tool list
  const data = MOD_DATA[modKey];
  if (data && data.tools.length > 0) {
    modalToolGrid.innerHTML = data.tools.map(t => {
      const badgeCls = t.type === 'read' ? 'modal-tool-badge--read'
        : t.type === 'write' ? 'modal-tool-badge--write'
        : 'modal-tool-badge--destructive';
      const label = t.type === 'read' ? 'read' : t.type === 'write' ? 'write' : 'destructive';
      return `<div class="modal-tool-item">
        <span class="modal-tool-name">${t.name}</span>
        <span class="modal-tool-desc">${t.desc}</span>
        <span class="modal-tool-badge ${badgeCls}">${label}</span>
      </div>`;
    }).join('');
    modalToolsSection.style.display = '';
  } else {
    modalToolsSection.style.display = 'none';
  }

  modal.classList.add('open');
  // Reset scroll
  document.querySelector('.modal-scroll')?.scrollTo(0, 0);
}

document.querySelectorAll('#moduleGrid .glass-card[data-detail]').forEach(card => {
  card.addEventListener('click', () => renderModal(card.dataset.modKey, card));
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
