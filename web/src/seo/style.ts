/**
 * The one stylesheet of every static page (inline, so a page is a single request). The content security policy
 * allows it by its SHA-256 hash (vite/securityHeaders.ts), so any change here changes the hash at build time
 * and nothing else has to be kept in step.
 *
 * Look (Faza 54-1, owner 2026-11-25: "imam top kartu ali onda… sve je nekako bezveze"): the pages are part of
 * the map's product, not documents beside it. The map's font (IBM Plex Sans, served from /fonts with its
 * OFL licence), the map's colours (app/tokens.css; the night is the map's dark theme), a bar on top in one
 * row like the map's, the heading and lead on the page itself and every section a card of its own, with
 * "On this page" beside long pages. Links that open the map are cards (`.doors`): the pages exist to lead there.
 *
 * Phone (Faza 31): tables scroll inside their own `.scroll` box instead of dragging the whole page sideways; a
 * number never parts from its unit in a table ("440 / MW"); definition lists become one column; the links of
 * the bar scroll sideways in a row of their own. Links and grey text keep 4.5:1 on the page and on a card.
 */
export const STATIC_STYLE = `
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/ibm-plex-sans-latin-400-normal.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/ibm-plex-sans-latin-ext-400-normal.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/ibm-plex-sans-latin-600-normal.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/ibm-plex-sans-latin-ext-600-normal.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
:root{--canvas:#dcdfe2;--surface:#eef0f1;--surface-2:#e4e7ea;--line:#c7cdd3;--ink:#1e262e;--muted:#56626d;--accent:#1d6a85;--accent-soft:rgba(31,111,139,.12);--warm:#b06612;--good:#23704b;--bad:#a3372f;--shadow:0 1px 2px rgba(30,38,46,.08),0 8px 24px rgba(30,38,46,.1);--font:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--canvas:#22282e;--surface:#2e353c;--surface-2:#363e46;--line:#46505a;--ink:#e6eaee;--muted:#a9b4be;--accent:#74c0da;--accent-soft:rgba(95,176,204,.16);--warm:#ffc680;--good:#6fc39a;--bad:#e8897f;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 28px rgba(0,0,0,.35)}}
*{box-sizing:border-box}html{scroll-padding-top:76px}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--canvas);color:var(--ink);font:400 16px/1.6 var(--font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--accent)}
.bar,main{width:100%;max-width:1180px;margin:0 auto;padding-left:24px;padding-right:24px}
.top{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--line);background:var(--surface)}
@supports(backdrop-filter:blur(1px)){.top{background:color-mix(in srgb,var(--surface) 86%,transparent);backdrop-filter:blur(14px) saturate(1.3)}}
.top .bar{display:flex;align-items:center;gap:6px 14px;min-height:60px}
.logo{display:flex;align-items:baseline;gap:10px;margin-right:auto;color:var(--ink);text-decoration:none;white-space:nowrap}
.logo b{position:relative;font-size:19px;font-weight:600;letter-spacing:-.02em}.logo b::after{content:"";position:absolute;left:0;bottom:-5px;width:100%;height:2px;border-radius:2px;background:linear-gradient(90deg,#ffc680,#5fb0cc)}
.logo span{color:var(--muted);font-size:13px}
.top a svg,.top summary svg{flex:none}
.primary{display:flex;align-items:center;gap:2px}
.primary a,.more summary,.lang{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:9px;color:var(--ink);font-size:14.5px;font-weight:600;text-decoration:none;white-space:nowrap}
.primary a svg,.lang svg{color:var(--muted)}
.primary a:hover,.more summary:hover,.lang:hover,.more[open] summary{background:var(--accent-soft)}
.primary a[aria-current]{background:var(--accent-soft);color:var(--accent)}.primary a[aria-current] svg{color:var(--accent)}
.primary .phone{display:none}
.more{position:relative}.more summary{list-style:none;cursor:pointer}.more summary::-webkit-details-marker{display:none}.more summary::after{content:"";width:6px;height:6px;margin:0 2px 3px 2px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg)}
.more>div{position:absolute;right:0;top:calc(100% + 8px);display:grid;gap:2px;min-width:220px;padding:6px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:var(--shadow)}
.more>div a{padding:9px 10px}
.open-map{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:10px;background:var(--accent);color:var(--surface);font-size:14.5px;font-weight:600;text-decoration:none;white-space:nowrap}.open-map:hover{filter:brightness(1.08)}
.top a:focus-visible,.top summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{flex:1;padding-top:30px;padding-bottom:40px}
.hero{max-width:820px;margin-bottom:24px}
h1{margin:0;font-size:clamp(28px,3.6vw,40px);font-weight:600;line-height:1.12;letter-spacing:-.025em}
.lead{margin-top:14px;color:var(--muted);font-size:17.5px;line-height:1.6}.lead p{margin:.5em 0 0}.lead p:first-child{margin-top:0}
.body{display:grid;grid-template-columns:minmax(0,1fr);gap:28px;align-items:start}
.body.with-side{grid-template-columns:minmax(0,1fr) 260px}
.content{min-width:0;display:grid;grid-template-columns:minmax(0,1fr);gap:18px}.content>*{margin:0}
.content>section{padding:22px 26px;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow);overflow-wrap:break-word}
.content>section>:last-child{margin-bottom:0}
section p,section li{max-width:72ch}
h2{margin:0 0 10px;font-size:21px;font-weight:600;line-height:1.25;letter-spacing:-.01em}h3{font-size:17px;font-weight:600;margin:22px 0 4px}h3+p{margin-top:0}
.side{position:sticky;top:84px}
.toc{padding:16px 16px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
.toc p{margin:0 0 8px 8px;color:var(--muted);font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.toc ol{margin:0;padding:0;list-style:none;display:grid;gap:1px}.toc a{display:block;padding:6px 8px;border-radius:8px;color:var(--ink);font-size:14.5px;line-height:1.35;text-decoration:none}.toc a:hover{background:var(--accent-soft);color:var(--accent)}
.scroll{overflow-x:auto;margin:8px 0}.scroll>table{margin:0}.scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:15px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}thead th{color:var(--muted);font-size:13.5px;font-weight:600}tbody tr:hover{background:var(--accent-soft)}
td.num,th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}td.num{white-space:nowrap}
dl{display:grid;grid-template-columns:fit-content(45%) minmax(0,1fr);gap:8px 20px;margin:8px 0}dt{color:var(--muted);overflow-wrap:anywhere}dd{margin:0;overflow-wrap:anywhere}
.doors{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.doors li{position:relative;max-width:none;margin:0;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:var(--shadow);transition:border-color .15s,transform .15s,box-shadow .15s}.doors li:hover{border-color:var(--accent);transform:translateY(-2px)}.doors a{display:block;font-weight:600;text-decoration:none}.doors a::before{content:"";position:absolute;inset:0}.doors a::after{content:" →"}.doors span{display:block;margin-top:4px;color:var(--muted);font-size:14.5px;line-height:1.45}.doors svg{float:left;margin:3px 9px 0 0;color:var(--warm)}.doors em{display:inline-block;margin-top:12px;padding:5px 12px;border:1px solid var(--accent);border-radius:999px;color:var(--accent);font-size:13px;font-style:normal;font-weight:600;transition:background-color .15s,color .15s}.doors li:hover em,.doors li:focus-within em{background:var(--accent);color:var(--surface)}.doors a:focus-visible{outline:none}.doors li:focus-within{outline:2px solid var(--accent);outline-offset:2px}
section .doors li{background:var(--surface-2);box-shadow:none}
.glossary{display:grid;gap:6px;margin:10px 0}.glossary details{border:1px solid var(--line);border-radius:10px;background:var(--surface-2)}.glossary summary{padding:10px 14px;font-weight:600;cursor:pointer}.glossary details[open] summary{border-bottom:1px solid var(--line)}.glossary p{margin:0;padding:10px 14px;max-width:none}.glossary summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:10px}
.callout{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;max-width:none;margin:14px 0;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.lead .callout{background:var(--surface)}.callout svg{flex:none;color:var(--warm)}.callout span{flex:1 1 240px}.callout a{flex:none;padding:8px 14px;border-radius:9px;background:var(--accent);color:var(--surface);font-weight:600;text-decoration:none}.callout a:hover{filter:brightness(1.08)}
.now{display:grid;gap:6px;margin:14px 0;padding:14px 16px;border:1px solid var(--line);border-left:3px solid var(--muted);border-radius:12px;background:var(--surface)}.now[hidden],.now [hidden]{display:none}.now[data-band=high]{border-left-color:#3fa86b}.now[data-band=mid]{border-left-color:#e0a526}.now[data-band=low]{border-left-color:#d9655b}.now-title{color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}.now-share{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600}.now-share b{font-size:30px;letter-spacing:-.02em}.now-share i{flex:none;width:12px;height:12px;border-radius:50%;background:var(--muted)}.now[data-band=high] .now-share i{background:#3fa86b}.now[data-band=mid] .now-share i{background:#e0a526}.now[data-band=low] .now-share i{background:#d9655b}.now-price em{display:none;font-style:normal;font-weight:600}.now-price[data-free=true] em{display:inline}.now-source{color:var(--muted);font-size:13px}.now-source b{font-weight:400}
.support{display:flex;flex-wrap:wrap;align-items:center;gap:14px 20px;margin:14px 0;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.support img{flex:none;border-radius:10px;background:#fff}.support p{margin:.3em 0}
.t-hydro{--c:#3F78AD}.t-pumped_storage{--c:#2A5A8A}.t-solar{--c:#D09A25}.t-wind{--c:#4E9F94}.t-nuclear{--c:#8466B0}.t-gas{--c:#C06F4D}.t-coal{--c:#5F564E}.t-lignite{--c:#86684B}.t-oil{--c:#9A4F3F}.t-biomass{--c:#6F9A4A}.t-geothermal{--c:#B5574F}.t-battery{--c:#4A8C8C}.t-other{--c:#8A949E}
@media(prefers-color-scheme:dark){.t-hydro{--c:#6E9FCC}.t-pumped_storage{--c:#8FB6E0}.t-solar{--c:#E0B654}.t-wind{--c:#7DC0B6}.t-nuclear{--c:#A792CC}.t-gas{--c:#D69476}.t-coal{--c:#A69A8F}.t-lignite{--c:#BE9A74}.t-oil{--c:#CF7E6C}.t-biomass{--c:#98B878}.t-geothermal{--c:#DB857C}.t-battery{--c:#7CC0C0}.t-other{--c:#A3AEB8}}
rect[class^=t-]{fill:var(--c)}i[class^=t-]{background:var(--c)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:0 0 22px}
.kpi{padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:var(--shadow)}.kpi.main{background:linear-gradient(135deg,color-mix(in srgb,var(--good) 20%,var(--surface)),var(--surface) 70%)}
.kpi p{margin:0;color:var(--muted);font-size:13.5px;line-height:1.45}.kpi .label{font-weight:600}
.kpi .big{margin:6px 0 4px;color:var(--ink);font-size:36px;font-weight:600;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.kpi .big small{margin-left:4px;color:var(--muted);font-size:17px;letter-spacing:0}
.delta{font-weight:600;white-space:nowrap}.delta b{font-size:.85em}.delta.good{color:var(--good)}.delta.bad{color:var(--bad)}.delta.neutral{color:var(--ink)}
.mix svg,.sbar svg,.columns svg,.rbar svg{display:block;width:100%}
.mix{margin:4px 0 16px}.mix svg{height:16px;border-radius:8px;overflow:hidden}
.sources{display:grid;gap:9px}.srow{display:grid;grid-template-columns:minmax(120px,170px) minmax(0,1fr) 120px 76px;gap:14px;align-items:center}
.sname{display:flex;align-items:center;gap:8px;font-weight:600;font-size:15px;line-height:1.2}.sname i,.key i{flex:none;width:10px;height:10px;border-radius:3px}
.sbar svg{height:21px}.sbar .was{fill:var(--muted);opacity:.5}
.sval{display:grid;text-align:right;line-height:1.2;font-variant-numeric:tabular-nums}.sval b{font-size:15.5px}.sval small{color:var(--muted);font-size:12.5px}
.schg{text-align:right;color:var(--muted);font-size:13.5px;font-weight:600;white-space:nowrap}
.key{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:6px;color:var(--muted);font-size:13px}.key span{display:inline-flex;align-items:center;gap:7px}.key i.cur{width:18px;height:9px;background:var(--accent)}.key i.was{width:18px;height:4px;background:var(--muted);opacity:.5}
.columns{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;margin:12px 0 4px}
.columns .axis{display:flex;flex-direction:column;justify-content:space-between;color:var(--muted);font-size:12px;line-height:1;text-align:right}
.columns svg{height:200px}.columns .grid line{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}
.columns .col{fill:color-mix(in srgb,var(--good) 42%,var(--surface-2))}.columns .col.prev{fill:color-mix(in srgb,var(--good) 72%,var(--surface-2))}.columns .col.cur{fill:var(--good)}.columns.neutral .col{fill:color-mix(in srgb,var(--accent) 38%,var(--surface-2))}.columns.neutral .col.cur{fill:var(--accent)}
.ticks{grid-column:2;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;color:var(--muted);font-size:12px;text-align:center;white-space:nowrap}.ticks span{overflow:visible}.ticks .cur{color:var(--ink);font-weight:600}
.ranking{display:grid;gap:4px}.rrow{display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) 160px;gap:14px;align-items:center;padding:7px 10px;border-radius:10px}.rrow.own{background:var(--accent-soft)}
.rname a{color:var(--ink);font-weight:600;text-decoration:none}.rname a:hover{color:var(--accent)}.rbar svg{height:10px}.rbar .track{fill:var(--surface-2)}.rbar .fill{fill:var(--good)}
details.data{margin-top:14px;padding-top:10px;border-top:1px solid var(--line)}details.data summary{color:var(--accent);font-weight:600;cursor:pointer}details.data summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
@media(max-width:640px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kpi{padding:13px 14px}.kpi .big{font-size:28px}.kpi .big small{font-size:14px}
.srow{grid-template-columns:minmax(0,1fr) auto;gap:2px 10px}.srow .sbar{grid-column:1/-1;grid-row:2}.srow .sval{grid-column:1;grid-row:3;display:flex;gap:8px;align-items:baseline;text-align:left}.srow .schg{grid-column:2;grid-row:1}
.rrow{grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:7px 8px}.rrow .rbar{grid-column:1/-1;grid-row:2}
.columns svg{height:150px}.ticks{font-size:11px}.ticks .minor{visibility:hidden}}
@media(prefers-reduced-motion:reduce){.doors li,.doors em{transition:none}.doors li:hover{transform:none}}
pre{overflow:auto;padding:10px 12px;border-radius:8px;background:var(--surface-2);font-size:14px}
.content>.cite{background:transparent;box-shadow:none;border-style:dashed}.cite h2{font-size:17px;color:var(--muted)}.cite p{font-size:14.5px}
nav.crumbs{font-size:14px;color:var(--muted);margin:0 0 14px}nav.crumbs a{color:var(--muted)}nav.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px}
nav.crumbs li+li::before{content:"›";margin-right:4px;color:var(--muted)}
footer{margin-top:auto;border-top:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:14px}footer .bar{padding-top:18px;padding-bottom:22px}footer p{margin:.4em 0}footer a{color:var(--muted)}footer a:hover{color:var(--accent)}
@media(max-width:1040px){.body.with-side{grid-template-columns:minmax(0,1fr)}.side{display:none}.logo span{display:none}}
@media(max-width:860px){.top .bar{flex-wrap:wrap;padding-top:8px}.primary{order:3;width:calc(100% + 48px);margin:0 -24px;padding:4px 20px 8px;overflow-x:auto;scrollbar-width:none}.primary::-webkit-scrollbar{display:none}.primary .phone{display:inline-flex}.more{display:none}.primary a{background:var(--surface-2)}.primary a[aria-current]{background:var(--accent-soft)}.lang span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
@media(max-width:560px){.bar,main{padding-left:16px;padding-right:16px}.primary{width:calc(100% + 32px);margin:0 -16px;padding:4px 12px 8px}.open-map{padding:8px 12px}main{padding-top:22px}.lead{font-size:16.5px}.content>section{padding:18px 16px;border-radius:14px}dl{grid-template-columns:minmax(0,1fr);gap:0}dt{margin-top:8px}}
@media(pointer:coarse){main li{margin:.35em 0}.doors li{margin:0}footer{line-height:2}.primary a,.lang,.open-map{min-height:44px}}
`.trim();
