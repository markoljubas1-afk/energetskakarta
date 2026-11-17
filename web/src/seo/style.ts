/**
 * The one stylesheet of every static page (inline, so a page is a single request). The content security policy
 * allows it by its SHA-256 hash (vite/securityHeaders.ts), so any change here changes the hash at build time
 * and nothing else has to be kept in step.
 *
 * Phone (Faza 31): tables scroll inside their own `.scroll` box instead of dragging the whole card sideways; a
 * number never parts from its unit in a table ("440 / MW"); definition lists become one column; the card loses
 * its side padding and corners. Links and grey text keep 4.5:1 on the page background as well as on the card.
 *
 * Look (owner's request 2026-11-17, "dosadno sive"): the page is the map's own night in the dark theme and
 * a light, cool paper in the light one, with the logo's warm-to-cool line along the top of the card and
 * before every section heading. Links that open the map are cards (`.doors`): the pages exist to lead there.
 */
export const STATIC_STYLE = `
:root{--canvas:#e9eef2;--surface:#fff;--line:#d3dbe2;--ink:#17202a;--muted:#55616c;--accent:#17627b;--warm:#c9791a;--glow:rgba(95,176,204,.16);color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--canvas:#0f161d;--surface:#19232d;--line:#2f3c48;--ink:#e8edf1;--muted:#a3b0bb;--accent:#6fbdd8;--warm:#ffc680;--glow:rgba(95,176,204,.13)}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse 90% 520px at 50% 0,var(--glow),transparent 70%) no-repeat,var(--canvas);color:var(--ink);font:400 16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header,main,footer{max-width:820px;margin:0 auto;padding:16px 28px}
header{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;border-bottom:1px solid var(--line)}
header strong{position:relative;padding-bottom:5px;font-size:17px;letter-spacing:-.015em}.tagline{color:var(--muted);font-size:13px;margin-right:auto}header strong::after{content:"";position:absolute;left:0;bottom:0;width:44px;height:2px;border-radius:2px;background:linear-gradient(90deg,#ffc680,#5fb0cc)}
nav a{color:var(--accent)}nav{display:flex;gap:16px;flex-wrap:wrap}header nav{gap:6px}header nav a{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:9px;color:var(--ink);font-size:14px;font-weight:600;text-decoration:none}header nav a:hover{border-color:var(--accent)}header nav a svg{flex:none;color:var(--accent)}
main{background:linear-gradient(90deg,#ffc680,#5fb0cc) top/100% 3px no-repeat,var(--surface);margin-top:16px;border:1px solid var(--line);border-top:0;border-radius:14px;padding:27px 28px 24px;overflow-x:auto;box-shadow:0 10px 30px -18px rgba(0,0,0,.35)}
main p,main li,.lead{max-width:68ch}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:19px;margin:30px 0 8px;padding-left:12px;border-left:3px solid var(--warm)}h3{font-size:17px;margin:24px 0 4px}h3+p{margin-top:0}
.lead{color:var(--muted);font-size:17px}
.scroll{overflow-x:auto;margin:8px 0}.scroll>table{margin:0}.scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}
td.num,th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}td.num{white-space:nowrap}
dl{display:grid;grid-template-columns:fit-content(45%) minmax(0,1fr);gap:6px 18px;margin:8px 0}dt{color:var(--muted);overflow-wrap:anywhere}dd{margin:0;overflow-wrap:anywhere}
a{color:var(--accent)}footer{color:var(--muted);font-size:14px}
.doors{list-style:none;margin:12px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}.doors li{position:relative;max-width:none;margin:0;padding:12px 14px 12px 16px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;background:var(--canvas);transition:border-color .15s,transform .15s}.doors li:hover{border-color:var(--accent);transform:translateY(-1px)}.doors a{display:block;font-weight:600;text-decoration:none}.doors a::before{content:"";position:absolute;inset:0}.doors a::after{content:" →"}.doors span{display:block;margin-top:2px;color:var(--muted);font-size:14px;line-height:1.4}.doors a:focus-visible{outline:none}.doors li:focus-within{outline:2px solid var(--accent);outline-offset:2px}@media(prefers-reduced-motion:reduce){.doors li{transition:none}.doors li:hover{transform:none}}
pre{overflow:auto;padding:10px 12px;border-radius:8px;background:var(--canvas);font-size:14px}
.cite{border-left:3px solid var(--line);padding-left:14px}
nav.crumbs{font-size:14px;color:var(--muted);margin:0 0 10px}nav.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px}
nav.crumbs li+li::before{content:"›";margin-right:4px;color:var(--muted)}
@media(max-width:560px){header,footer{padding:12px 16px}main{padding:23px 16px 20px;border-radius:0;border-left:0;border-right:0;margin-top:8px}h1{font-size:24px}dl{grid-template-columns:minmax(0,1fr);gap:0}dt{margin-top:8px}}
@media(pointer:coarse){main li{margin:.35em 0}.doors li{margin:0}footer{line-height:2}}
`.trim();
