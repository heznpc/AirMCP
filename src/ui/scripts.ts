// JXA scripts for macOS UI automation via System Events accessibility API.

import { esc } from "../shared/esc.js";

/**
 * Open an application by name or bundle ID and return an accessibility tree summary.
 */
export function uiOpenAppScript(appName: string): string {
  return `
    const se = Application('System Events');
    const app = Application('${esc(appName)}');
    app.activate();
    delay(0.5);

    const proc = se.processes.whose({frontmost: true})()[0];
    const procName = proc.name();
    const bundleId = proc.bundleIdentifier();
    const pid = proc.unixId();

    const wins = [];
    try {
      const windows = proc.windows();
      for (let i = 0; i < Math.min(windows.length, 5); i++) {
        const w = windows[i];
        const winInfo = { title: '', role: '', size: null, position: null, elementSummary: [] };
        try { winInfo.title = w.name() || ''; } catch(e) {}
        try { winInfo.role = w.role() || ''; } catch(e) {}
        try { winInfo.size = w.size(); } catch(e) {}
        try { winInfo.position = w.position(); } catch(e) {}

        // Collect top-level UI element summary
        try {
          const elems = w.uiElements();
          for (let j = 0; j < Math.min(elems.length, 50); j++) {
            try {
              const el = elems[j];
              winInfo.elementSummary.push({
                role: el.role() || '',
                title: el.title ? el.title() || '' : '',
                description: el.description ? el.description() || '' : ''
              });
            } catch(e) {}
          }
        } catch(e) {}
        wins.push(winInfo);
      }
    } catch(e) {}

    JSON.stringify({
      activated: true,
      name: procName,
      bundleIdentifier: bundleId,
      pid: pid,
      windowCount: wins.length,
      windows: wins
    });
  `;
}

/**
 * Click a UI element by coordinates or by searching for text within a role.
 */
export function uiClickScript(
  appName?: string,
  x?: number,
  y?: number,
  text?: string,
  role?: string,
  index?: number,
): string {
  // Click by coordinates
  if (x !== undefined && y !== undefined) {
    return `
      const se = Application('System Events');
      ${appName ? `Application('${esc(appName)}').activate(); delay(0.3);` : ""}
      const app = Application.currentApplication();
      app.includeStandardAdditions = true;
      app.doShellScript('cliclick c:${x},${y}');
      JSON.stringify({ clicked: true, method: 'coordinate', x: ${x}, y: ${y} });
    `;
  }

  // Click by text search within UI hierarchy
  const roleFilter = role ? `el.role() === '${esc(role)}'` : "true";
  const searchText = text ? esc(text) : "";
  const targetIndex = index ?? 0;

  return `
    const se = Application('System Events');
    ${appName ? `Application('${esc(appName)}').activate(); delay(0.3);` : ""}

    const proc = se.processes.whose({frontmost: true})()[0];
    const wins = proc.windows();
    if (wins.length === 0) throw new Error('No windows found for frontmost app');

    function findElement(parent, depth) {
      if (depth > 8) return [];
      const results = [];
      let elems;
      try { elems = parent.uiElements(); } catch(e) { return []; }
      for (let i = 0; i < elems.length; i++) {
        const el = elems[i];
        try {
          const matches = ${roleFilter};
          if (matches) {
            let name = '';
            let desc = '';
            let val = '';
            let ttl = '';
            try { name = el.name() || ''; } catch(e) {}
            try { desc = el.description() || ''; } catch(e) {}
            try { val = String(el.value() || ''); } catch(e) {}
            try { ttl = el.title ? (el.title() || '') : ''; } catch(e) {}
            const combined = (name + ' ' + desc + ' ' + val + ' ' + ttl).toLowerCase();
            if (combined.indexOf('${searchText}'.toLowerCase()) !== -1) {
              results.push(el);
            }
          }
        } catch(e) {}
        const children = findElement(el, depth + 1);
        for (let c = 0; c < children.length; c++) results.push(children[c]);
      }
      return results;
    }

    const found = findElement(wins[0], 0);
    if (found.length === 0) throw new Error('No matching UI element found for text: ${searchText}');
    const idx = Math.min(${targetIndex}, found.length - 1);
    const target = found[idx];
    se.click(target);
    let clickedName = '';
    let clickedRole = '';
    try { clickedName = target.name() || ''; } catch(e) {}
    try { clickedRole = target.role() || ''; } catch(e) {}
    JSON.stringify({
      clicked: true,
      method: 'text_search',
      matchCount: found.length,
      selectedIndex: idx,
      element: { name: clickedName, role: clickedRole }
    });
  `;
}

/**
 * Type text into the currently focused field.
 */
export function uiTypeScript(text: string, appName?: string): string {
  return `
    const se = Application('System Events');
    ${appName ? `Application('${esc(appName)}').activate(); delay(0.3);` : ""}
    se.keystroke('${esc(text)}');
    JSON.stringify({ typed: true, length: ${text.length} });
  `;
}

/**
 * Send a key combination (e.g., Cmd+S, Ctrl+C, Return).
 */
export function uiPressKeyScript(
  key: string,
  modifiers?: string[],
  appName?: string,
): string {
  // Map of special key names to key codes
  const keyCodeMap: Record<string, number> = {
    return: 36,
    enter: 76,
    tab: 48,
    space: 49,
    delete: 51,
    escape: 53,
    esc: 53,
    left: 123,
    right: 124,
    down: 125,
    up: 126,
    f1: 122,
    f2: 120,
    f3: 99,
    f4: 118,
    f5: 96,
    f6: 97,
    f7: 98,
    f8: 100,
    f9: 101,
    f10: 109,
    f11: 103,
    f12: 111,
    home: 115,
    end: 119,
    pageup: 116,
    pagedown: 121,
    forwarddelete: 117,
  };

  const modMap: Record<string, string> = {
    command: "command down",
    cmd: "command down",
    shift: "shift down",
    option: "option down",
    alt: "option down",
    control: "control down",
    ctrl: "control down",
  };

  const validModifiers = new Set(Object.keys(modMap));
  const usingParts = (modifiers ?? [])
    .filter((m) => validModifiers.has(m.toLowerCase()))
    .map((m) => modMap[m.toLowerCase()])
    .filter((v, i, a) => a.indexOf(v) === i);
  const usingStr = usingParts.length > 0 ? `, {using: [${usingParts.map((m) => `'${m}'`).join(", ")}]}` : "";

  const keyLower = key.toLowerCase();
  const keyCode = keyCodeMap[keyLower];

  if (keyCode !== undefined) {
    return `
      const se = Application('System Events');
      ${appName ? `Application('${esc(appName)}').activate(); delay(0.3);` : ""}
      se.keyCode(${keyCode}${usingStr});
      JSON.stringify({ pressed: true, keyCode: ${keyCode}, key: '${esc(key)}' });
    `;
  }

  // Single character keystroke
  return `
    const se = Application('System Events');
    ${appName ? `Application('${esc(appName)}').activate(); delay(0.3);` : ""}
    se.keystroke('${esc(key)}'${usingStr});
    JSON.stringify({ pressed: true, key: '${esc(key)}' });
  `;
}

/**
 * Scroll at given coordinates.
 */
export function uiScrollScript(
  direction: "up" | "down" | "left" | "right",
  amount: number,
  appName?: string,
): string {
  // AppleScript scroll uses number of "clicks" — positive is up/left, negative is down/right
  let scrollX = 0;
  let scrollY = 0;
  switch (direction) {
    case "up":
      scrollY = amount;
      break;
    case "down":
      scrollY = -amount;
      break;
    case "left":
      scrollX = amount;
      break;
    case "right":
      scrollX = -amount;
      break;
  }

  return `
    const se = Application('System Events');
    ${appName ? `Application('${esc(appName)}').activate(); delay(0.3);` : ""}

    const proc = se.processes.whose({frontmost: true})()[0];
    const wins = proc.windows();
    if (wins.length === 0) throw new Error('No windows found for frontmost app');

    // Find the first scroll area or the window itself
    let scrollTarget = wins[0];
    try {
      const scrollAreas = wins[0].scrollAreas();
      if (scrollAreas.length > 0) scrollTarget = scrollAreas[0];
    } catch(e) {}

    // Use AppleScript's scroll via key events as a reliable cross-app approach
    for (let i = 0; i < ${Math.abs(amount)}; i++) {
      ${scrollY > 0 ? "se.keyCode(126); // up arrow" : ""}
      ${scrollY < 0 ? "se.keyCode(125); // down arrow" : ""}
      ${scrollX > 0 ? "se.keyCode(123); // left arrow" : ""}
      ${scrollX < 0 ? "se.keyCode(124); // right arrow" : ""}
    }

    JSON.stringify({
      scrolled: true,
      direction: '${direction}',
      amount: ${amount}
    });
  `;
}

/**
 * Read the accessibility tree of the frontmost app (or specified app).
 */
export function uiReadScript(appName?: string, maxDepth?: number, maxElements?: number): string {
  const depth = maxDepth ?? 3;
  const maxElems = maxElements ?? 200;

  return `
    const se = Application('System Events');
    ${appName ? `Application('${esc(appName)}').activate(); delay(0.3);` : ""}

    const proc = se.processes.whose({frontmost: true})()[0];
    const procName = proc.name();
    const bundleId = proc.bundleIdentifier();

    let totalCount = 0;
    const maxCount = ${maxElems};
    let truncated = false;

    function readTree(el, depth) {
      if (depth <= 0 || totalCount >= maxCount) {
        if (totalCount >= maxCount) truncated = true;
        return null;
      }
      totalCount++;
      const node = { role: '', name: '', title: '', value: '', description: '', enabled: null, focused: null, position: null, size: null, children: [] };
      try { node.role = el.role() || ''; } catch(e) {}
      try { node.name = el.name() || ''; } catch(e) {}
      try { node.title = el.title ? (el.title() || '') : ''; } catch(e) {}
      try {
        const v = el.value();
        node.value = v !== null && v !== undefined ? String(v) : '';
      } catch(e) {}
      try { node.description = el.description ? (el.description() || '') : ''; } catch(e) {}
      try { node.enabled = el.enabled(); } catch(e) {}
      try { node.focused = el.focused(); } catch(e) {}
      try { node.position = el.position(); } catch(e) {}
      try { node.size = el.size(); } catch(e) {}

      try {
        const children = el.uiElements();
        for (let i = 0; i < children.length && totalCount < maxCount; i++) {
          const child = readTree(children[i], depth - 1);
          if (child) node.children.push(child);
        }
      } catch(e) {}

      return node;
    }

    const wins = [];
    try {
      const windows = proc.windows();
      for (let i = 0; i < Math.min(windows.length, 5); i++) {
        const tree = readTree(windows[i], ${depth});
        if (tree) wins.push(tree);
      }
    } catch(e) {}

    // Also capture menu bar items
    const menuItems = [];
    try {
      const menuBar = proc.menuBars[0];
      const menus = menuBar.menuBarItems();
      for (let i = 0; i < menus.length && totalCount < maxCount; i++) {
        try {
          menuItems.push({ title: menus[i].title() || '', name: menus[i].name() || '' });
          totalCount++;
        } catch(e) {}
      }
    } catch(e) {}

    JSON.stringify({
      app: procName,
      bundleIdentifier: bundleId,
      windowCount: wins.length,
      elementCount: totalCount,
      truncated: truncated,
      maxDepth: ${depth},
      windows: wins,
      menuBar: menuItems
    });
  `;
}
