/**
 * The one stylesheet of every static page (inline, so a page is a single request). The content security policy
 * allows it by its SHA-256 hash (vite/securityHeaders.ts), so any change here changes the hash at build time
 * and nothing else has to be kept in step.
 *
 * Phone (Faza 31): tables scroll inside their own `.scroll` box instead of dragging the whole card sideways; a
 * number never parts from its unit in a table ("440 / MW"); definition lists become one column; the card loses
 * its side padding and corners. Links and grey text keep 4.5:1 on the page background as well as on the card.
 */
export const STATIC_STYLE = `
:root{--canvas:#dcdfe2;--surface:#eef0f1;--line:#c7cdd3;--ink:#1e262e;--muted:#56616b;--accent:#1a6680;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--canvas:#2a3036;--surface:#343b42;--line:#4b545d;--ink:#e4e8ec;--muted:#a3aeb8;--accent:#5fb0cc}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:400 16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header,main,footer{max-width:820px;margin:0 auto;padding:16px 28px}
header{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;border-bottom:1px solid var(--line)}
header strong{font-size:17px}nav a{color:var(--accent)}nav{display:flex;gap:16px;flex-wrap:wrap}
main{background:var(--surface);margin-top:16px;border-radius:14px;padding:24px 28px;overflow-x:auto}
main p,main li,.lead{max-width:68ch}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:19px;margin:28px 0 8px}h3{font-size:17px;margin:24px 0 4px}h3+p{margin-top:0}
.lead{color:var(--muted);font-size:17px}
.scroll{overflow-x:auto;margin:8px 0}.scroll>table{margin:0}.scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}
td.num,th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}td.num{white-space:nowrap}
dl{display:grid;grid-template-columns:fit-content(45%) minmax(0,1fr);gap:6px 18px;margin:8px 0}dt{color:var(--muted);overflow-wrap:anywhere}dd{margin:0;overflow-wrap:anywhere}
a{color:var(--accent)}footer{color:var(--muted);font-size:14px}
pre{overflow:auto;padding:10px 12px;border-radius:8px;background:var(--canvas);font-size:14px}
.cite{border-left:3px solid var(--line);padding-left:14px}
nav.crumbs{font-size:14px;color:var(--muted);margin:0 0 10px}nav.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px}
nav.crumbs li+li::before{content:"›";margin-right:4px;color:var(--muted)}
@media(max-width:560px){header,footer{padding:12px 16px}main{padding:20px 16px;border-radius:0;margin-top:8px}h1{font-size:24px}dl{grid-template-columns:minmax(0,1fr);gap:0}dt{margin-top:8px}}
@media(pointer:coarse){main li{margin:.35em 0}footer{line-height:2}}
`.trim();
