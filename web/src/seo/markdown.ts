/**
 * Markdown twins of the static pages (todo 16-C2): `index.md` next to every `index.html`, linked from its head
 * (`rel="alternate" type="text/markdown"`), plus `llms-full.txt` with the main English pages in one file.
 * AI assistants and agents read Markdown more cheaply and more reliably than HTML with styles and navigation.
 *
 * The converter handles exactly the HTML the page generators emit (p, a, ul/li, table, h3, dl, pre/code);
 * a test renders every page and fails if any tag is left over.
 */
import { createI18n } from "../i18n";
import { pageCitation } from "./citation";
import { COPY } from "./copy";
import { doors } from "./markup";
import type { SiteData, StaticPage } from "./site";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

const decode = (text: string): string =>
  text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/** Characters that would start Markdown syntax inside table cells and text. */
const escapeCell = (text: string): string => text.replaceAll("|", "\\|");

/** Inline HTML → Markdown: links (made absolute), code, then every other tag dropped and entities decoded. */
export function inline(html: string, base: string | null): string {
  const absolute = (href: string): string => (base && href.startsWith("/") ? base + href : href);
  return decode(
    html
      .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href: string, text: string) => {
        const label = text.replace(/<[^>]+>/g, "").trim();
        return `[${label}](${absolute(decode(href))})`;
      })
      .replace(/<code>([\s\S]*?)<\/code>/g, (_m, code: string) => `\`${code}\``)
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function table(html: string, base: string | null): string {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row = ""]) =>
    [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell = ""]) =>
      escapeCell(inline(cell, base)),
    ),
  );
  const [head, ...body] = rows;
  if (!head) return "";
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...body.map(line)].join("\n");
}

/** Block HTML (one section) → Markdown. */
export function blocks(html: string, base: string | null): string {
  const parts: string[] = [];
  const pattern =
    /<table>[\s\S]*?<\/table>|<ul[^>]*>[\s\S]*?<\/ul>|<dl>[\s\S]*?<\/dl>|<details>[\s\S]*?<\/details>|<pre><code>[\s\S]*?<\/code><\/pre>|<h3>[\s\S]*?<\/h3>|<p[^>]*>[\s\S]*?<\/p>/g;
  for (const [block] of html.matchAll(pattern)) {
    if (block.startsWith("<table")) parts.push(table(block, base));
    else if (block.startsWith("<ul"))
      parts.push(
        [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)]
          .map(([, item = ""]) => `- ${inline(item, base)}`)
          .join("\n"),
      );
    else if (block.startsWith("<dl"))
      parts.push(
        [...block.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)]
          .map(([, term = "", value = ""]) => `- **${inline(term, base)}**: ${inline(value, base)}`)
          .join("\n"),
      );
    else if (block.startsWith("<details")) {
      const [, term = "", text = ""] =
        /<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/.exec(block) ?? [];
      parts.push(`- **${inline(term, base)}**: ${inline(text, base)}`);
    } else if (block.startsWith("<pre"))
      parts.push(`\`\`\`\n${decode(block.replace(/^<pre><code>|<\/code><\/pre>$/g, ""))}\n\`\`\``);
    else if (block.startsWith("<h3")) parts.push(`### ${inline(block, base)}`);
    else parts.push(inline(block, base));
  }
  return parts.filter((part) => part !== "").join("\n\n");
}

/** A page as Markdown: title, lead, sections, then where it lives, the data date and the licence. */
export function pageMarkdown(page: StaticPage, site: SiteData): string {
  const base = site.siteUrl;
  const i18n = createI18n(page.lang);
  const copy = COPY[page.lang];
  const address = base ? base + page.path : page.path;
  const footer = [
    `${page.lang === "hr" ? "Stranica" : "Page"}: ${address}`,
    i18n.t("dataVersion", { date: i18n.date(page.lastModified) }),
    // the page's own source note (HEP, ENTSO-E) is in its sections; this is the site-wide line, in its language
    copy.footer,
    `${page.lang === "hr" ? "Kako citirati (APA)" : "How to cite (APA)"}: ${pageCitation(page, site).apa}`,
  ];
  return [
    `# ${page.heading}`,
    page.description,
    blocks(page.lead, base),
    page.doors && page.doors.length > 0 ? blocks(doors(page.doors), base) : "",
    ...[...page.sections, ...(page.nav ? [page.nav] : [])].map(
      (section) => `## ${section.heading}\n\n${blocks(section.html, base)}`,
    ),
    `---\n\n${copy.siteTitle}\n\n${footer.map((line) => `- ${line}`).join("\n")}`,
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n")
    .concat("\n");
}

/** Where a page's Markdown twin lives: "/zemlja/hr/" → "/zemlja/hr/index.md". */
export const markdownPath = (path: string): string => `${path}index.md`;

/**
 * The main English pages in one file for assistants that read a site in one go: about, the countries, the
 * largest plants, grid capacity, generation and prices (those that exist in this release).
 */
export function llmsFull(pages: readonly StaticPage[], site: SiteData): string {
  const wanted = (page: StaticPage): boolean =>
    page.lang === "en" &&
    (page.path === "/en/about/" ||
      /^\/en\/country\/[a-z]{2}\/$/.test(page.path) ||
      page.path === "/en/largest-power-plants/" ||
      page.path === "/en/grid-capacity/" ||
      page.path === "/en/electricity-generation/" ||
      page.path === "/en/electricity-prices/" ||
      page.path === "/en/energy-transition/" ||
      page.path === "/en/gas/");
  const chosen = pages.filter(wanted);
  return [
    `# ${COPY.en.siteTitle}: full text of the main pages`,
    `${COPY.en.siteDescription} Every page also exists as Markdown: add index.md to its address (the pages of single plants, substations and cities have their JSON in the API instead). Croatian pages: ${site.siteUrl ?? ""}/o-karti/index.md`,
    ...chosen.map((page) => pageMarkdown(page, site).replace(/^# /, "## ").replace(/\n## /g, "\n### ")),
  ].join("\n\n---\n\n");
}
