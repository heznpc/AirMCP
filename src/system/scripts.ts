// JXA scripts for macOS system automation.

import { esc, escJxaShell } from "../shared/esc.js";

export function getClipboardScript(): string {
  // Limit clipboard content to avoid exceeding osascript stdout maxBuffer (10 MB).
  const MAX_CHARS = 5_000_000; // ~5 MB of text, safe margin below 10 MB buffer
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    let text;
    try { text = app.theClipboard(); } catch(e) { text = ''; }
    let content = (typeof text === 'object') ? JSON.stringify(text) : String(text);
    const truncated = content.length > ${MAX_CHARS};
    if (truncated) content = content.substring(0, ${MAX_CHARS});
    JSON.stringify({content: content, length: content.length, truncated: truncated});
  `;
}

export function setClipboardScript(text: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const text = '${esc(text)}';
    app.setTheClipboardTo(text);
    JSON.stringify({set: true, length: text.length});
  `;
}

export function getVolumeScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const vol = app.getVolumeSettings();
    JSON.stringify({
      outputVolume: vol.outputVolume,
      inputVolume: vol.inputVolume,
      outputMuted: vol.outputMuted
    });
  `;
}

export function setVolumeScript(volume?: number, muted?: boolean): string {
  const parts: string[] = [];
  if (volume !== undefined) parts.push(`outputVolume: ${Math.max(0, Math.min(100, Math.round(volume)))}`);
  if (muted !== undefined) parts.push(`outputMuted: ${muted}`);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.setVolume(null, {${parts.join(", ")}});
    const vol = app.getVolumeSettings();
    JSON.stringify({
      outputVolume: vol.outputVolume,
      outputMuted: vol.outputMuted
    });
  `;
}

export function toggleDarkModeScript(): string {
  return `
    const se = Application('System Events');
    const current = se.appearancePreferences.darkMode();
    se.appearancePreferences.darkMode = !current;
    JSON.stringify({darkMode: !current});
  `;
}

export function getFrontmostAppScript(): string {
  return `
    const se = Application('System Events');
    const procs = se.processes.whose({frontmost: true})();
    if (procs.length === 0) throw new Error('No frontmost app found');
    const proc = procs[0];
    JSON.stringify({
      name: proc.name(),
      bundleIdentifier: proc.bundleIdentifier(),
      pid: proc.unixId()
    });
  `;
}

export function listRunningAppsScript(): string {
  return `
    const se = Application('System Events');
    const procs = se.applicationProcesses();
    const result = [];
    for (const p of procs) {
      try {
        result.push({
          name: p.name(),
          bundleIdentifier: p.bundleIdentifier(),
          pid: p.unixId(),
          visible: p.visible()
        });
      } catch(e) {}
    }
    JSON.stringify({total: result.length, apps: result});
  `;
}

export function getScreenInfoScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('system_profiler SPDisplaysDataType -json');
    const data = JSON.parse(output);
    const displays = [];
    for (const gpu of (data.SPDisplaysDataType || [])) {
      for (const d of (gpu.spdisplays_ndrvs || [])) {
        displays.push({
          name: d._name,
          resolution: d._spdisplays_resolution,
          pixelWidth: d._spdisplays_pixels ? parseInt(d._spdisplays_pixels.split(' x ')[0]) : null,
          pixelHeight: d._spdisplays_pixels ? parseInt(d._spdisplays_pixels.split(' x ')[1]) : null,
          retina: d.spdisplays_retina === 'spdisplays_yes'
        });
      }
    }
    JSON.stringify({displays: displays});
  `;
}

export function captureScreenshotScript(path: string, region?: string): string {
  const regionFlag = region === "selection" ? " -i" : region === "window" ? " -w" : "";
  const safePath = escJxaShell(path);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('screencapture -x${regionFlag} "${safePath}"');
    const info = app.doShellScript('stat -f "%z" "${safePath}"');
    JSON.stringify({captured: true, path: '${esc(path)}', sizeBytes: parseInt(info)});
  `;
}

export function showNotificationScript(message: string, title?: string, subtitle?: string, sound?: string): string {
  const opts: string[] = [];
  if (title) opts.push(`withTitle: '${esc(title)}'`);
  if (subtitle) opts.push(`subtitle: '${esc(subtitle)}'`);
  if (sound) opts.push(`soundName: '${esc(sound)}'`);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.displayNotification('${esc(message)}', {${opts.join(', ')}});
    JSON.stringify({sent: true, message: '${esc(message)}'});
  `;
}

export function getWifiStatusScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I 2>/dev/null || echo "WiFi off"');
    const lines = output.split('\\n');
    const info = {};
    for (const line of lines) {
      const match = line.match(/^\\s*([^:]+):\\s*(.+)$/);
      if (match) info[match[1].trim()] = match[2].trim();
    }
    JSON.stringify({
      ssid: info['SSID'] || null,
      bssid: info['BSSID'] || null,
      signalStrength: info['agrCtlRSSI'] ? parseInt(info['agrCtlRSSI']) : null,
      noiseLevel: info['agrCtlNoise'] ? parseInt(info['agrCtlNoise']) : null,
      channel: info['channel'] || null,
      connected: !!info['SSID'],
      raw: output
    });
  `;
}

export function toggleWifiScript(enable: boolean): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('networksetup -setairportpower en0 ${enable ? "on" : "off"}');
    JSON.stringify({wifi: ${enable ? "'on'" : "'off'"}, success: true});
  `;
}

export function listBluetoothDevicesScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('system_profiler SPBluetoothDataType -json 2>/dev/null');
    const data = JSON.parse(output);
    const devices = [];
    const btData = data.SPBluetoothDataType || [];
    for (const section of btData) {
      const devicesMap = section.devices_list || section.device_connected || [];
      for (const entry of (Array.isArray(devicesMap) ? devicesMap : [devicesMap])) {
        if (typeof entry === 'object' && entry !== null) {
          for (const name of Object.keys(entry)) {
            const info = entry[name] || {};
            devices.push({
              name: name,
              connected: info.device_connected === 'device_connected_yes' || info.device_connected === 'attrib_Yes' || false,
              address: info.device_address || null,
              type: info.device_minorType || null
            });
          }
        }
      }
    }
    JSON.stringify({total: devices.length, devices: devices});
  `;
}

export function getBrightnessScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('ioreg -c AppleBacklightDisplay -d 1 | grep -i brightness | head -1 2>/dev/null || echo ""');
    let brightness = null;
    const match = output.match(/"brightness"\\s*=\\s*(\\d+)/);
    if (match) {
      brightness = parseInt(match[1]) / 1024;
    }
    JSON.stringify({brightness: brightness, raw: output});
  `;
}

export function setBrightnessScript(level: number): string {
  const clamped = Math.max(0, Math.min(1, level));
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    try {
      app.doShellScript('brightness ${clamped}');
      JSON.stringify({brightness: ${clamped}, success: true});
    } catch(e) {
      JSON.stringify({brightness: null, success: false, error: 'brightness CLI not found. Install via: brew install brightness'});
    }
  `;
}

export function getBatteryStatusScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('pmset -g batt');
    const lines = output.split('\\n');
    let percentage = null;
    let charging = false;
    let timeRemaining = null;
    let source = null;
    for (const line of lines) {
      if (line.indexOf('AC Power') !== -1) source = 'AC Power';
      if (line.indexOf('Battery Power') !== -1) source = 'Battery Power';
      const pctMatch = line.match(/(\\d+)%/);
      if (pctMatch) percentage = parseInt(pctMatch[1]);
      if (line.indexOf('charging') !== -1 && line.indexOf('discharging') === -1 && line.indexOf('not charging') === -1) charging = true;
      const timeMatch = line.match(/(\\d+:\\d+) remaining/);
      if (timeMatch) timeRemaining = timeMatch[1];
    }
    JSON.stringify({
      percentage: percentage,
      charging: charging,
      source: source,
      timeRemaining: timeRemaining,
      raw: output
    });
  `;
}

export function toggleFocusModeScript(enable: boolean): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('defaults -currentHost write com.apple.notificationcenterui doNotDisturb -boolean ${enable ? "true" : "false"}');
    app.doShellScript('killall NotificationCenter 2>/dev/null || true');
    JSON.stringify({doNotDisturb: ${enable}, success: true});
  `;
}

export function systemSleepScript(): string {
  return `
    const se = Application('System Events');
    se.sleep();
    JSON.stringify({action: 'sleep', success: true});
  `;
}

export function preventSleepScript(seconds: number): string {
  const secs = Math.max(1, Math.round(seconds));
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const pid = app.doShellScript('caffeinate -t ${secs} & echo $!');
    JSON.stringify({action: 'prevent_sleep', pid: parseInt(pid.trim()), seconds: ${secs}});
  `;
}

const ALLOWED_POWER_ACTIONS = new Set(["shutdown", "restart"]);

export function systemPowerScript(action: string): string {
  if (!ALLOWED_POWER_ACTIONS.has(action)) {
    throw new Error(`Invalid power action: ${action}`);
  }
  return `
    const se = Application('System Events');
    se.${action}();
    JSON.stringify({action: '${action}', success: true});
  `;
}

// --- App Management ---

export function launchAppScript(name: string): string {
  return `
    const app = Application('${esc(name)}');
    app.activate();
    JSON.stringify({launched: true, name: '${esc(name)}'});
  `;
}

export function quitAppScript(name: string): string {
  return `
    const app = Application('${esc(name)}');
    app.quit();
    JSON.stringify({quit: true, name: '${esc(name)}'});
  `;
}

export function isAppRunningScript(name: string): string {
  return `
    const se = Application('System Events');
    const procs = se.processes.whose({name: '${esc(name)}'})();
    if (procs.length > 0) {
      const p = procs[0];
      JSON.stringify({running: true, name: p.name(), bundleIdentifier: p.bundleIdentifier(), pid: p.unixId(), visible: p.visible()});
    } else {
      JSON.stringify({running: false, name: '${esc(name)}'});
    }
  `;
}

// --- Window Management ---

export function listAllWindowsScript(): string {
  return `
    const se = Application('System Events');
    const procs = se.processes.whose({backgroundOnly: false})();
    const results = [];
    for (let p = 0; p < procs.length; p++) {
      const proc = procs[p];
      let procName = '';
      let pid = 0;
      try { procName = proc.name(); } catch(e) { continue; }
      try { pid = proc.unixId(); } catch(e) {}
      let wins;
      try { wins = proc.windows(); } catch(e) { continue; }
      for (let w = 0; w < wins.length; w++) {
        const win = wins[w];
        const info = {app: procName, pid: pid, title: '', position: null, size: null, minimized: false};
        try { info.title = win.name() || ''; } catch(e) {}
        try { info.position = win.position(); } catch(e) {}
        try { info.size = win.size(); } catch(e) {}
        try { info.minimized = win.minimized ? win.minimized() : false; } catch(e) {}
        results.push(info);
      }
    }
    JSON.stringify({total: results.length, windows: results});
  `;
}

function windowSelector(appName: string, windowTitle?: string): string {
  if (windowTitle) {
    return `const proc = se.processes.byName('${esc(appName)}');
    const wins = proc.windows.whose({name: '${esc(windowTitle)}'})();
    if (wins.length === 0) throw new Error('No window found: ${esc(windowTitle)}');
    const win = wins[0];`;
  }
  return `const proc = se.processes.byName('${esc(appName)}');
    const wins = proc.windows();
    if (wins.length === 0) throw new Error('No windows found for ${esc(appName)}');
    const win = wins[0];`;
}

export function moveWindowScript(appName: string, x: number, y: number, windowTitle?: string): string {
  return `
    const se = Application('System Events');
    ${windowSelector(appName, windowTitle)}
    win.position = [${x}, ${y}];
    JSON.stringify({moved: true, app: '${esc(appName)}', position: win.position()});
  `;
}

export function resizeWindowScript(appName: string, width: number, height: number, windowTitle?: string): string {
  return `
    const se = Application('System Events');
    ${windowSelector(appName, windowTitle)}
    win.size = [${width}, ${height}];
    JSON.stringify({resized: true, app: '${esc(appName)}', size: win.size()});
  `;
}

export function minimizeWindowScript(appName: string, restore: boolean, windowTitle?: string): string {
  return `
    const se = Application('System Events');
    ${windowSelector(appName, windowTitle)}
    win.minimized = ${!restore};
    JSON.stringify({app: '${esc(appName)}', minimized: ${!restore}});
  `;
}
