// MCP Apps — interactive UI views for Calendar and Music.

import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { runJxa } from "../shared/jxa.js";
import { listEventsScript } from "../calendar/scripts.js";
import { nowPlayingScript } from "../music/scripts.js";

const CALENDAR_WEEK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans,system-ui,-apple-system,sans-serif);background:var(--color-background-primary,#fff);color:var(--color-text-primary,#111)}
.header{padding:16px;font-size:18px;font-weight:600;border-bottom:1px solid var(--color-border-primary,#e5e5e5)}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--color-border-primary,#e5e5e5)}
.day{background:var(--color-background-primary,#fff);min-height:120px;padding:8px}
.day-hdr{font-size:11px;font-weight:600;color:var(--color-text-secondary,#888);text-transform:uppercase;letter-spacing:.5px}
.day-num{font-size:20px;font-weight:700;margin:2px 0 6px}
.ev{background:#007aff;color:#fff;border-radius:4px;padding:2px 6px;font-size:11px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}
.today{background:var(--color-background-secondary,#f5f5f5)}
.today .day-num{color:#007aff}
.loading{display:flex;align-items:center;justify-content:center;height:200px;color:var(--color-text-secondary,#999)}
</style></head><body>
<div class="header" id="hdr">Calendar</div>
<div id="content"><div class="loading">Loading events\u2026</div></div>
<script type="module">
import{App}from"https://esm.sh/@modelcontextprotocol/ext-apps@1.2.2";
const app=new App({name:"AirMCP Calendar",version:"1.0.0"});
app.onhostcontextchanged=ctx=>{
  if(ctx.styles?.variables)Object.entries(ctx.styles.variables).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
};
app.ontoolresult=r=>{try{
  const t=r.content?.find(c=>c.type==="text")?.text;
  if(t)render(JSON.parse(t));
}catch(e){document.getElementById("content").innerHTML='<div class="loading">Error</div>'}};
function render(d){
  const{weekStart,events}=d,s=new Date(weekStart),days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
  today=new Date().toISOString().slice(0,10);
  document.getElementById("hdr").textContent="Week of "+s.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
  let h='<div class="grid">';
  for(let i=0;i<7;i++){
    const dd=new Date(s);dd.setDate(dd.getDate()+i);
    const ds=dd.toISOString().slice(0,10),isT=ds===today;
    const de=(events||[]).filter(e=>e.startDate&&e.startDate.startsWith(ds));
    h+='<div class="day'+(isT?" today":"")+'"><div class="day-hdr">'+days[i]+'</div><div class="day-num">'+dd.getDate()+"</div>";
    for(const e of de){const tm=e.allDay?"":e.startDate.slice(11,16)+" ";h+='<div class="ev" title="'+esc(e.summary)+'">'+tm+esc(e.summary)+"</div>"}
    h+="</div>"}
  h+="</div>";document.getElementById("content").innerHTML=h}
function esc(s){const d=document.createElement("div");d.textContent=s||"";return d.innerHTML}
await app.connect();
</script></body></html>`;

const MUSIC_PLAYER_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans,system-ui,-apple-system,sans-serif);background:var(--color-background-primary,#1a1a1a);color:var(--color-text-primary,#fff);display:flex;align-items:center;justify-content:center;min-height:200px;padding:24px}
.player{text-align:center;width:100%;max-width:360px}
.art{width:180px;height:180px;border-radius:16px;background:var(--color-background-secondary,#333);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:56px}
.name{font-size:18px;font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.artist{font-size:14px;color:var(--color-text-secondary,#aaa);margin-bottom:2px}
.album{font-size:12px;color:var(--color-text-tertiary,#777);margin-bottom:12px}
.state{display:inline-block;font-size:11px;color:var(--color-text-secondary,#aaa);text-transform:capitalize;background:rgba(255,255,255,.1);padding:2px 10px;border-radius:10px;margin-bottom:12px}
.bar-wrap{width:100%;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin-bottom:6px;overflow:hidden}
.bar{height:100%;background:#007aff;border-radius:2px;transition:width .3s}
.time{display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-secondary,#888)}
.stopped{color:var(--color-text-secondary,#888);font-size:15px}
</style></head><body>
<div class="player" id="p"><div class="stopped">No track playing</div></div>
<script type="module">
import{App}from"https://esm.sh/@modelcontextprotocol/ext-apps@1.2.2";
const app=new App({name:"AirMCP Music",version:"1.0.0"});
app.onhostcontextchanged=ctx=>{
  if(ctx.styles?.variables)Object.entries(ctx.styles.variables).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
};
app.ontoolresult=r=>{try{
  const t=r.content?.find(c=>c.type==="text")?.text;
  if(t)render(JSON.parse(t));
}catch(e){}};
function fmt(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return m+":"+String(sec).padStart(2,"0")}
function render(d){
  const el=document.getElementById("p");
  if(d.playerState==="stopped"||!d.track){el.innerHTML='<div class="stopped">No track playing</div>';return}
  const t=d.track,pct=t.duration>0?(t.playerPosition/t.duration*100):0;
  el.innerHTML=
    '<div class="art">\\u266B</div>'+
    '<div class="name">'+esc(t.name)+'</div>'+
    '<div class="artist">'+esc(t.artist)+'</div>'+
    '<div class="album">'+esc(t.album)+'</div>'+
    '<div class="state">'+d.playerState+'</div>'+
    '<div class="bar-wrap"><div class="bar" style="width:'+pct+'%"></div></div>'+
    '<div class="time"><span>'+fmt(t.playerPosition||0)+'</span><span>'+fmt(t.duration||0)+'</span></div>'}
function esc(s){const d=document.createElement("div");d.textContent=s||"";return d.innerHTML}
await app.connect();
</script></body></html>`;

function getWeekMonday(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  // Use local date parts — toISOString() returns UTC which shifts dates in UTC+ timezones
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function registerApps(server: McpServer, opts: { calendar: boolean; music: boolean }): void {
  if (!opts.calendar && !opts.music) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ext-apps SDK expects full McpServer generics
  const s = server as any;

  if (opts.calendar) {
    // Calendar Week View
    registerAppTool(
      s,
      "calendar_week_view",
      {
        title: "Calendar Week View",
        description: "Display an interactive calendar week view showing events for a 7-day period.",
        inputSchema: {
          startDate: z
            .string()
            .max(64)
            .optional()
            .describe("Start date (YYYY-MM-DD). Defaults to current week's Monday."),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { ui: { resourceUri: "ui://airmcp/calendar-week" } },
      },
      async ({ startDate }) => {
        const weekStart = getWeekMonday(startDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const endStr = weekEnd.toISOString().slice(0, 10);
        const raw = await runJxa(listEventsScript(weekStart, endStr, 50, 0));
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ weekStart, events: parsed.events ?? [] }),
            },
          ],
        };
      },
    );

    registerAppResource(
      s,
      "Calendar Week View",
      "ui://airmcp/calendar-week",
      { description: "Interactive calendar week grid" },
      async () => ({
        contents: [
          {
            uri: "ui://airmcp/calendar-week",
            mimeType: RESOURCE_MIME_TYPE,
            text: CALENDAR_WEEK_HTML,
            _meta: { ui: { csp: { resourceDomains: ["https://esm.sh"] } } },
          },
        ],
      }),
    );
  } // calendar

  if (opts.music) {
    // Music Player
    registerAppTool(
      s,
      "music_player",
      {
        title: "Music Player",
        description: "Display an interactive music player showing the currently playing track.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { ui: { resourceUri: "ui://airmcp/music-player" } },
      },
      async () => {
        const data = await runJxa(nowPlayingScript());
        return {
          content: [
            {
              type: "text" as const,
              text: typeof data === "string" ? data : JSON.stringify(data),
            },
          ],
        };
      },
    );

    registerAppResource(
      s,
      "Music Player",
      "ui://airmcp/music-player",
      { description: "Interactive music player view" },
      async () => ({
        contents: [
          {
            uri: "ui://airmcp/music-player",
            mimeType: RESOURCE_MIME_TYPE,
            text: MUSIC_PLAYER_HTML,
            _meta: { ui: { csp: { resourceDomains: ["https://esm.sh"] } } },
          },
        ],
      }),
    );
  } // music
}
