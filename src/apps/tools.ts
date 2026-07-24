// MCP Apps — interactive UI views for Calendar and Music.

import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { runJxa } from "../shared/jxa.js";
import { wrapUntrustedText, UNTRUSTED_CONTENT_META } from "../shared/untrusted.js";
import { listEventsScript, todayEventsScript } from "../calendar/scripts.js";
import { nowPlayingScript } from "../music/scripts.js";
import { listRemindersScript } from "../reminders/scripts.js";

// MCP Apps must render offline and without expanding the iframe CSP to a CDN.
// `app-with-deps` is already a production dependency; inline its browser bundle
// into each resource and replace the ESM export tail with one private binding.
const require = createRequire(import.meta.url);
const extAppsBundle = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
const appExport = /([A-Za-z_$][\w$]*) as App(?=[,}])/.exec(extAppsBundle)?.[1];
const exportStart = extAppsBundle.lastIndexOf("export{");
if (!appExport || exportStart < 0) {
  throw new Error("Unable to prepare the bundled MCP Apps client");
}
const EXT_APPS_CLIENT_SOURCE = (
  extAppsBundle.slice(0, exportStart) + `globalThis.__AirMCPAppsApp=${appExport};`
).replaceAll("</script", "<\\/script");

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
${EXT_APPS_CLIENT_SOURCE}
const App=globalThis.__AirMCPAppsApp;
const app=new App({name:"AirMCP Calendar",version:"1.0.0"});
app.onhostcontextchanged=ctx=>{
  if(ctx.styles?.variables)Object.entries(ctx.styles.variables).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
};
app.ontoolresult=r=>{try{
  let d=r.structuredContent;
  if(d==null){let t=r.content?.find(c=>c.type==="text")?.text;if(t){if(t.startsWith("[UNTRUSTED")){const a=t.indexOf("\\n"),b=t.lastIndexOf("\\n");if(a>-1&&b>a)t=t.slice(a+1,b);}d=JSON.parse(t);}}
  if(d)render(d);
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

// Timeline view — fuses today's calendar events and dueDate-carrying
// reminders onto a single 6am–10pm vertical axis. Events with no start
// time and reminders without a dueDate collapse into an "unscheduled"
// rail on the right so they don't disappear.
const TIMELINE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans,system-ui,-apple-system,sans-serif);background:var(--color-background-primary,#fff);color:var(--color-text-primary,#111)}
.header{padding:16px;font-size:18px;font-weight:600;border-bottom:1px solid var(--color-border-primary,#e5e5e5);display:flex;justify-content:space-between;align-items:baseline}
.header .sub{font-size:12px;color:var(--color-text-secondary,#888);font-weight:400}
.body{display:grid;grid-template-columns:1fr 200px;gap:16px;padding:12px}
.axis{position:relative;min-height:640px}
.row{position:relative;height:40px;border-top:1px dashed var(--color-border-primary,#eee)}
.row .h{position:absolute;left:0;top:-8px;font-size:10px;color:var(--color-text-tertiary,#aaa);width:44px;text-align:right;padding-right:6px}
.track{position:absolute;left:48px;right:0;top:0;bottom:0}
.ev{position:absolute;left:0;right:8px;background:#007aff;color:#fff;border-radius:4px;padding:4px 8px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.rm{background:#ff9500}
.rail{padding:8px}
.rail h3{font-size:11px;text-transform:uppercase;color:var(--color-text-secondary,#888);letter-spacing:.5px;margin-bottom:6px}
.chip{display:block;padding:6px 8px;background:var(--color-background-secondary,#f5f5f5);border-radius:6px;margin-bottom:4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip.rm{border-left:3px solid #ff9500}
.chip.ev{color:var(--color-text-primary,#111);background:var(--color-background-secondary,#f5f5f5);border-left:3px solid #007aff}
.empty{color:var(--color-text-tertiary,#bbb);font-size:11px;padding:8px 0}
.loading{display:flex;align-items:center;justify-content:center;height:200px;color:var(--color-text-secondary,#999)}
</style></head><body>
<div class="header" id="hdr"><span>Timeline</span><span class="sub" id="sub"></span></div>
<div id="content"><div class="loading">Loading timeline\u2026</div></div>
<script type="module">
${EXT_APPS_CLIENT_SOURCE}
const App=globalThis.__AirMCPAppsApp;
const app=new App({name:"AirMCP Timeline",version:"1.0.0"});
app.onhostcontextchanged=ctx=>{
  if(ctx.styles?.variables)Object.entries(ctx.styles.variables).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
};
app.ontoolresult=r=>{try{
  let d=r.structuredContent;
  if(d==null){let t=r.content?.find(c=>c.type==="text")?.text;if(t){if(t.startsWith("[UNTRUSTED")){const a=t.indexOf("\\n"),b=t.lastIndexOf("\\n");if(a>-1&&b>a)t=t.slice(a+1,b);}d=JSON.parse(t);}}
  if(d)render(d);
}catch(e){document.getElementById("content").innerHTML='<div class="loading">Error</div>'}};
function esc(s){const d=document.createElement("div");d.textContent=s||"";return d.innerHTML}
function hhmm(iso){const d=new Date(iso);return d.getHours()*60+d.getMinutes()}
// 6am → 10pm axis = 16 hours × 40px slots
const START_H=6,END_H=22,SLOT_PX=40;
function render(d){
  const{events=[],reminders=[],date}=d;
  document.getElementById("sub").textContent=date||new Date().toISOString().slice(0,10);
  const scheduled={events:[],reminders:[]},unscheduled={events:[],reminders:[]};
  for(const e of events){
    if(!e.startDate||e.allDay){unscheduled.events.push(e);continue}
    const mins=hhmm(e.startDate);
    if(mins<START_H*60||mins>=END_H*60){unscheduled.events.push(e);continue}
    scheduled.events.push({...e,_offset:(mins-START_H*60)/60*SLOT_PX,_mins:mins});
  }
  for(const r of reminders){
    if(!r.dueDate){unscheduled.reminders.push(r);continue}
    const mins=hhmm(r.dueDate);
    if(mins<START_H*60||mins>=END_H*60){unscheduled.reminders.push(r);continue}
    scheduled.reminders.push({...r,_offset:(mins-START_H*60)/60*SLOT_PX});
  }
  let axis='<div class="axis">';
  for(let h=START_H;h<END_H;h++){
    const label=h<12?h+' AM':h===12?'12 PM':(h-12)+' PM';
    axis+='<div class="row"><span class="h">'+label+'</span></div>';
  }
  axis+='<div class="track">';
  for(const e of scheduled.events){
    axis+='<div class="ev" style="top:'+e._offset+'px;height:32px" title="'+esc(e.summary)+'">'+esc(e.summary)+'</div>';
  }
  for(const r of scheduled.reminders){
    axis+='<div class="ev rm" style="top:'+r._offset+'px;height:32px" title="'+esc(r.name)+'">'+esc(r.name)+'</div>';
  }
  axis+='</div></div>';
  let rail='<div class="rail"><h3>Unscheduled</h3>';
  if(!unscheduled.events.length&&!unscheduled.reminders.length){rail+='<div class="empty">Nothing pending</div>'}
  for(const e of unscheduled.events){rail+='<span class="chip ev" title="'+esc(e.summary)+'">'+esc(e.summary)+'</span>'}
  for(const r of unscheduled.reminders){rail+='<span class="chip rm" title="'+esc(r.name)+'">'+esc(r.name)+'</span>'}
  rail+='</div>';
  document.getElementById("content").innerHTML='<div class="body">'+axis+rail+'</div>';
}
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
${EXT_APPS_CLIENT_SOURCE}
const App=globalThis.__AirMCPAppsApp;
const app=new App({name:"AirMCP Music",version:"1.0.0"});
app.onhostcontextchanged=ctx=>{
  if(ctx.styles?.variables)Object.entries(ctx.styles.variables).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
};
app.ontoolresult=r=>{try{
  let d=r.structuredContent;
  if(d==null){let t=r.content?.find(c=>c.type==="text")?.text;if(t){if(t.startsWith("[UNTRUSTED")){const a=t.indexOf("\\n"),b=t.lastIndexOf("\\n");if(a>-1&&b>a)t=t.slice(a+1,b);}d=JSON.parse(t);}}
  if(d)render(d);
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
    '<div class="state">'+esc(d.playerState)+'</div>'+
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

export function registerApps(server: McpServer, opts: { calendar: boolean; music: boolean; timeline?: boolean }): void {
  if (!opts.calendar && !opts.music && !opts.timeline) return;
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
        // Calendar event titles/locations/notes are attacker-controllable via
        // external invites — fence the text the model sees. The widget renders
        // from structuredContent (raw object), so the fence never reaches it.
        const payload = { weekStart, events: parsed.events ?? [] };
        return {
          content: [{ type: "text" as const, text: wrapUntrustedText(JSON.stringify(payload)) }],
          structuredContent: payload,
          _meta: UNTRUSTED_CONTENT_META,
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
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
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
        // Track/artist metadata can carry injected text — fence the model-facing
        // copy; the widget reads the raw object from structuredContent.
        let payload: Record<string, unknown>;
        if (typeof data === "string") {
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            payload = { nowPlaying: data };
          }
        } else {
          payload = (data ?? {}) as Record<string, unknown>;
        }
        return {
          content: [{ type: "text" as const, text: wrapUntrustedText(JSON.stringify(payload)) }],
          structuredContent: payload,
          _meta: UNTRUSTED_CONTENT_META,
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
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
          },
        ],
      }),
    );
  } // music

  if (opts.timeline) {
    // Timeline view — today's calendar events + dueDate-carrying reminders
    // laid out on a 6am–10pm vertical axis, with an "unscheduled" rail
    // for items that don't fit a time slot (all-day events, reminders
    // without a due time). This is the first built-in App that fuses
    // two data sources into a single UI.
    registerAppTool(
      s,
      "timeline_today",
      {
        title: "Timeline (Today)",
        description:
          "Display today's events and due reminders on a single day-axis timeline. " +
          "Fuses Calendar + Reminders; items without a start/due time fall into an 'Unscheduled' rail.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { ui: { resourceUri: "ui://airmcp/timeline-today" } },
      },
      async () => {
        // Gather in parallel — a slow source shouldn't block the render.
        // Both can independently fail (app not running, permission denied)
        // and we still want to show whichever side succeeded.
        const [eventsRaw, remindersRaw] = await Promise.allSettled([
          runJxa(todayEventsScript()),
          runJxa(listRemindersScript(50, 0, undefined, false)),
        ]);
        const eventsParsed =
          eventsRaw.status === "fulfilled"
            ? typeof eventsRaw.value === "string"
              ? (JSON.parse(eventsRaw.value) as { events?: unknown[] })
              : (eventsRaw.value as { events?: unknown[] })
            : { events: [] };
        const remindersParsed =
          remindersRaw.status === "fulfilled"
            ? typeof remindersRaw.value === "string"
              ? (JSON.parse(remindersRaw.value) as { reminders?: unknown[] })
              : (remindersRaw.value as { reminders?: unknown[] })
            : { reminders: [] };
        const today = new Date().toISOString().slice(0, 10);
        // Event + reminder text is attacker-controllable (shared calendars /
        // reminder lists) — fence the model-facing copy; the widget renders
        // from structuredContent (raw object).
        const payload = {
          date: today,
          events: eventsParsed.events ?? [],
          reminders: remindersParsed.reminders ?? [],
        };
        return {
          content: [{ type: "text" as const, text: wrapUntrustedText(JSON.stringify(payload)) }],
          structuredContent: payload,
          _meta: UNTRUSTED_CONTENT_META,
        };
      },
    );

    registerAppResource(
      s,
      "Timeline (Today)",
      "ui://airmcp/timeline-today",
      { description: "Interactive day-axis timeline fusing calendar events and due reminders" },
      async () => ({
        contents: [
          {
            uri: "ui://airmcp/timeline-today",
            mimeType: RESOURCE_MIME_TYPE,
            text: TIMELINE_HTML,
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
          },
        ],
      }),
    );
  } // timeline
}
