// JXA scripts for Apple Maps automation.

import { esc } from "../shared/esc.js";

export function searchLocationScript(query: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const query = '${esc(query)}';
    app.openLocation('maps://?q=' + encodeURIComponent(query));
    JSON.stringify({ searched: true, query: query });
  `;
}

export function getDirectionsScript(from: string, to: string, transportType?: string): string {
  const flag = transportType === "walking" ? "w" : transportType === "transit" ? "r" : "d";
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const saddr = '${esc(from)}';
    const daddr = '${esc(to)}';
    const dirflg = '${flag}';
    app.openLocation('maps://?saddr=' + encodeURIComponent(saddr) + '&daddr=' + encodeURIComponent(daddr) + '&dirflg=' + dirflg);
    JSON.stringify({ directions: true, from: saddr, to: daddr, transportType: '${esc(transportType ?? "driving")}' });
  `;
}

export function dropPinScript(latitude: number, longitude: number, label?: string): string {
  const labelPart = label ? ` + '&q=' + encodeURIComponent('${esc(label)}')` : "";
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.openLocation('maps://?ll=${latitude},${longitude}'${labelPart});
    JSON.stringify({ pinned: true, latitude: ${latitude}, longitude: ${longitude}${label ? `, label: '${esc(label)}'` : ""} });
  `;
}

export function openInMapsScript(address: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const addr = '${esc(address)}';
    app.openLocation('maps://?address=' + encodeURIComponent(addr));
    JSON.stringify({ opened: true, address: addr });
  `;
}

export function searchNearbyScript(query: string, latitude?: number, longitude?: number): string {
  const nearPart =
    latitude !== undefined && longitude !== undefined
      ? ` + '&near=' + encodeURIComponent('${latitude},${longitude}')`
      : "";
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const query = '${esc(query)}';
    app.openLocation('maps://?q=' + encodeURIComponent(query)${nearPart});
    JSON.stringify({ searched: true, query: query${latitude !== undefined && longitude !== undefined ? `, near: { latitude: ${latitude}, longitude: ${longitude} }` : ""} });
  `;
}

export function shareLocationScript(latitude: number, longitude: number, label?: string): string {
  const labelParam = label ? `&q=${encodeURIComponent(label)}` : "";
  const url = `https://maps.apple.com/?ll=${latitude},${longitude}${labelParam}`;
  return `
    JSON.stringify({ url: '${esc(url)}' });
  `;
}
