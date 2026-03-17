/**
 * Accessibility query engine — JXA scripts for precise UI element
 * lookup by locator (role + title/value/description) and action execution.
 *
 * Inspired by steipete/macos-automator-mcp accessibility_query pattern
 * and mediar-ai/mcp-server-macos-use BFS traversal.
 */
import { esc } from "../shared/esc.js";

// ── Locator types ────────────────────────────────────────────────────

export interface AXLocator {
  app?: string;
  role?: string;      // AXButton, AXTextField, AXStaticText, etc.
  title?: string;     // AXTitle match (substring)
  value?: string;     // AXValue match (substring)
  description?: string; // AXDescription match
  identifier?: string;  // AXIdentifier exact match
  label?: string;     // AXLabel match (combined search)
}

// ── Accessibility Query Script ───────────────────────────────────────

export function axQueryScript(
  locator: AXLocator,
  maxResults: number,
  maxDepth: number,
): string {
  const roleFilter = locator.role ? `el.role() === '${esc(locator.role)}'` : "true";
  const checks: string[] = [];
  if (locator.title) checks.push(`ttl.indexOf('${esc(locator.title).toLowerCase()}') !== -1`);
  if (locator.value) checks.push(`val.indexOf('${esc(locator.value).toLowerCase()}') !== -1`);
  if (locator.description) checks.push(`desc.indexOf('${esc(locator.description).toLowerCase()}') !== -1`);
  if (locator.identifier) checks.push(`ident === '${esc(locator.identifier)}'`);
  if (locator.label) checks.push(`combined.indexOf('${esc(locator.label).toLowerCase()}') !== -1`);
  const matchExpr = checks.length > 0 ? checks.join(" && ") : "true";

  return `
    const se = Application('System Events');
    ${locator.app ? `Application('${esc(locator.app)}').activate(); delay(0.5);` : ""}

    const proc = se.processes.whose({frontmost: true})()[0];
    const procName = proc.name();
    const pid = proc.unixId();
    const wins = proc.windows();

    const results = [];
    const maxR = ${maxResults};
    const maxD = ${maxDepth};
    let visited = 0;

    function search(parent, depth, path) {
      if (depth > maxD || results.length >= maxR) return;
      let elems;
      try { elems = parent.uiElements(); } catch(e) { return; }
      for (let i = 0; i < elems.length && results.length < maxR; i++) {
        const el = elems[i];
        visited++;
        try {
          if (!(${roleFilter})) { search(el, depth + 1, path + '/' + i); continue; }
          let name = '', ttl = '', val = '', desc = '', ident = '', role = '';
          try { role = el.role() || ''; } catch(e) {}
          try { name = (el.name() || '').toLowerCase(); } catch(e) {}
          try { ttl = (el.title ? (el.title() || '') : '').toLowerCase(); } catch(e) {}
          try { val = String(el.value() || '').toLowerCase(); } catch(e) {}
          try { desc = (el.description ? (el.description() || '') : '').toLowerCase(); } catch(e) {}
          try { ident = el.attributes.byName('AXIdentifier').value() || ''; } catch(e) {}
          const combined = name + ' ' + ttl + ' ' + val + ' ' + desc;

          if (${matchExpr}) {
            let pos = null, sz = null, enabled = null, focused = null;
            try { pos = el.position(); } catch(e) {}
            try { sz = el.size(); } catch(e) {}
            try { enabled = el.enabled(); } catch(e) {}
            try { focused = el.focused(); } catch(e) {}
            results.push({
              index: results.length,
              path: path + '/' + i,
              role: role,
              name: el.name ? (el.name() || '') : '',
              title: el.title ? (el.title() || '') : '',
              value: el.value ? String(el.value() || '') : '',
              description: el.description ? (el.description() || '') : '',
              identifier: ident,
              position: pos,
              size: sz,
              enabled: enabled,
              focused: focused,
            });
          }
        } catch(e) {}
        search(el, depth + 1, path + '/' + i);
      }
    }

    for (let w = 0; w < Math.min(wins.length, 5); w++) {
      search(wins[w], 0, 'win' + w);
    }

    JSON.stringify({
      app: procName,
      pid: pid,
      query: ${JSON.stringify(locator)},
      matchCount: results.length,
      visited: visited,
      elements: results,
    });
  `;
}

// ── Perform Action Script ────────────────────────────────────────────

export function axPerformScript(
  locator: AXLocator,
  action: string,
  actionValue?: string,
  index?: number,
): string {
  // First find the element using the same query, then perform action
  const queryPart = axQueryScript(locator, 50, 10);
  // Strip the final JSON.stringify from the query
  const queryBody = queryPart.slice(0, queryPart.lastIndexOf("JSON.stringify"));

  const targetIdx = index ?? 0;
  const act = esc(action);

  return `
    ${queryBody}

    if (results.length === 0) throw new Error('No matching element found for action: ${act}');
    const idx = Math.min(${targetIdx}, results.length - 1);

    // Re-find the actual element to perform action on
    let targetEl = null;
    let searchCount = 0;

    function findByPath(parent, targetPath, depth) {
      if (depth > 12 || targetEl) return;
      let elems;
      try { elems = parent.uiElements(); } catch(e) { return; }
      for (let i = 0; i < elems.length; i++) {
        searchCount++;
        const curPath = (depth === 0 ? 'win0' : '') + '/' + i;
        // Match by comparing element properties
        try {
          const el = elems[i];
          const r = el.role ? (el.role() || '') : '';
          const n = el.name ? (el.name() || '') : '';
          const t = el.title ? (el.title() || '') : '';
          if (r === results[idx].role && n === results[idx].name && t === results[idx].title) {
            targetEl = el;
            return;
          }
        } catch(e) {}
        findByPath(elems[i], targetPath, depth + 1);
      }
    }

    for (let w = 0; w < Math.min(wins.length, 5) && !targetEl; w++) {
      findByPath(wins[w], results[idx].path, 0);
    }

    if (!targetEl) throw new Error('Could not re-locate element for action');

    // Perform the action
    const actionName = '${act}';
    let actionResult = 'performed';
    try {
      if (actionName === 'AXPress' || actionName === 'press' || actionName === 'click') {
        se.click(targetEl);
        actionResult = 'clicked';
      } else if (actionName === 'AXPick' || actionName === 'pick' || actionName === 'select') {
        targetEl.selected = true;
        actionResult = 'selected';
      } else if (actionName === 'AXConfirm' || actionName === 'confirm') {
        se.click(targetEl);
        actionResult = 'confirmed';
      } else if (actionName === 'AXSetValue' || actionName === 'setValue' || actionName === 'set') {
        targetEl.value = '${actionValue ? esc(actionValue) : ""}';
        actionResult = 'value set';
      } else if (actionName === 'AXRaise' || actionName === 'raise' || actionName === 'focus') {
        targetEl.focused = true;
        actionResult = 'focused';
      } else if (actionName === 'AXShowMenu' || actionName === 'showMenu') {
        try { targetEl.actions.byName('AXShowMenu').perform(); } catch(e) { se.click(targetEl); }
        actionResult = 'menu shown';
      } else {
        // Try generic AX action
        try {
          targetEl.actions.byName(actionName).perform();
          actionResult = actionName + ' performed';
        } catch(e) {
          throw new Error('Unknown action: ' + actionName + '. Available: press, pick, confirm, setValue, raise, showMenu');
        }
      }
    } catch(e) {
      throw new Error('Action failed: ' + actionName + ' — ' + e.message);
    }

    JSON.stringify({
      action: actionName,
      result: actionResult,
      element: results[idx],
    });
  `;
}

// ── BFS Traverse Script (mediar-ai style) ────────────────────────────

export function axTraverseScript(
  app?: string,
  pid?: number,
  maxDepth?: number,
  maxElements?: number,
  onlyVisible?: boolean,
): string {
  const depth = maxDepth ?? 5;
  const maxElems = maxElements ?? 500;

  return `
    const se = Application('System Events');
    ${app ? `Application('${esc(app)}').activate(); delay(0.5);` : ""}

    let proc;
    ${pid ? `
    const procs = se.processes.whose({unixId: ${pid}})();
    if (procs.length === 0) throw new Error('No process found with PID ${pid}');
    proc = procs[0];
    ` : `
    proc = se.processes.whose({frontmost: true})()[0];
    `}

    const procName = proc.name();
    const procPid = proc.unixId();
    const bundleId = proc.bundleIdentifier();

    let count = 0;
    const maxC = ${maxElems};
    const maxD = ${depth};
    const onlyVis = ${onlyVisible ?? false};

    // BFS traversal
    function bfs(root) {
      const queue = [{ el: root, depth: 0, parent: null }];
      const nodes = [];

      while (queue.length > 0 && count < maxC) {
        const { el, depth: d, parent: p } = queue.shift();
        if (d > maxD) continue;
        count++;

        const node = {
          id: count,
          parentId: p,
          depth: d,
          role: '', name: '', title: '', value: '',
          description: '', identifier: '',
          position: null, size: null,
          enabled: null, focused: null, selected: null,
          childCount: 0,
        };

        try { node.role = el.role() || ''; } catch(e) {}
        try { node.name = el.name() || ''; } catch(e) {}
        try { node.title = el.title ? (el.title() || '') : ''; } catch(e) {}
        try { node.value = el.value ? String(el.value() || '') : ''; } catch(e) {}
        try { node.description = el.description ? (el.description() || '') : ''; } catch(e) {}
        try { node.identifier = el.attributes.byName('AXIdentifier').value() || ''; } catch(e) {}
        try { node.position = el.position(); } catch(e) {}
        try { node.size = el.size(); } catch(e) {}
        try { node.enabled = el.enabled(); } catch(e) {}
        try { node.focused = el.focused(); } catch(e) {}
        try { node.selected = el.selected ? el.selected() : null; } catch(e) {}

        if (onlyVis && node.position) {
          const [x, y] = node.position;
          const [w, h] = node.size || [0, 0];
          if (w <= 0 || h <= 0 || x < -1000 || y < -1000) { continue; }
        }

        nodes.push(node);

        try {
          const children = el.uiElements();
          node.childCount = children.length;
          for (let i = 0; i < children.length && count < maxC; i++) {
            queue.push({ el: children[i], depth: d + 1, parent: count });
          }
        } catch(e) {}
      }

      return nodes;
    }

    const allNodes = [];
    try {
      const windows = proc.windows();
      for (let w = 0; w < Math.min(windows.length, 5); w++) {
        const nodes = bfs(windows[w]);
        allNodes.push(...nodes);
      }
    } catch(e) {}

    JSON.stringify({
      app: procName,
      pid: procPid,
      bundleId: bundleId,
      totalElements: count,
      maxDepth: maxD,
      truncated: count >= maxC,
      elements: allNodes,
    });
  `;
}

// ── UI Diff Script ───────────────────────────────────────────────────

export function axDiffScript(
  beforeSnapshot: string,
  app?: string,
): string {
  return `
    const se = Application('System Events');
    ${app ? `Application('${esc(app)}').activate(); delay(0.3);` : ""}

    const proc = se.processes.whose({frontmost: true})()[0];
    const procName = proc.name();

    // Take "after" snapshot
    let count = 0;
    function snap(parent, depth) {
      if (depth > 5 || count > 300) return [];
      const result = [];
      let elems;
      try { elems = parent.uiElements(); } catch(e) { return []; }
      for (let i = 0; i < elems.length && count < 300; i++) {
        count++;
        const el = elems[i];
        const node = { role: '', name: '', title: '', value: '' };
        try { node.role = el.role() || ''; } catch(e) {}
        try { node.name = el.name() || ''; } catch(e) {}
        try { node.title = el.title ? (el.title() || '') : ''; } catch(e) {}
        try { node.value = el.value ? String(el.value() || '') : ''; } catch(e) {}
        node.children = snap(el, depth + 1);
        result.push(node);
      }
      return result;
    }

    const wins = proc.windows();
    const afterTree = [];
    for (let w = 0; w < Math.min(wins.length, 3); w++) {
      afterTree.push(...snap(wins[w], 0));
    }

    // Compare with before snapshot
    const before = JSON.parse(${JSON.stringify(beforeSnapshot)});
    const changes = [];

    function flatten(tree, prefix) {
      const flat = {};
      for (const n of tree) {
        const key = prefix + '/' + n.role + ':' + n.name;
        flat[key] = n.value || n.title || '';
        if (n.children) Object.assign(flat, flatten(n.children, key));
      }
      return flat;
    }

    const beforeFlat = flatten(before, '');
    const afterFlat = flatten(afterTree, '');

    for (const [k, v] of Object.entries(afterFlat)) {
      if (!(k in beforeFlat)) changes.push({ type: 'added', path: k, value: v });
      else if (beforeFlat[k] !== v) changes.push({ type: 'changed', path: k, before: beforeFlat[k], after: v });
    }
    for (const k of Object.keys(beforeFlat)) {
      if (!(k in afterFlat)) changes.push({ type: 'removed', path: k });
    }

    JSON.stringify({
      app: procName,
      changeCount: changes.length,
      changes: changes.slice(0, 50),
    });
  `;
}
