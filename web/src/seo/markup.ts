/**
 * The few HTML helpers the static pages are written with (Faza 26 split from pages.ts); every value is escaped.
 */
import { createI18n } from "../i18n";
import type { Lang } from "../state/url";

// ---------------------------------------------------------------- words

/** "488 trafostanica", "302 trafostanice" / "1 substation": the count of substations after "od" / "of". */
export function stationsOf(lang: Lang, count: number): string {
  return counted(
    lang,
    count,
    lang === "hr"
      ? ["trafostanice", "trafostanice", "trafostanica"]
      : ["substation", "substations", "substations"],
  );
}

/** Noun forms for Intl.PluralRules' one, few and other ("1 gradu", "2 grada", "5 gradova"). */
export type Forms = readonly [one: string, few: string, other: string];

/**
 * A number with its noun in the right form: "1 lokacija", "3 lokacije", "8,4 postotna boda". The rules see the
 * number as it is shown (rounded to `digits`), because Croatian agrees with the last digit, decimals included.
 */
export function counted(lang: Lang, value: number, forms: Forms, digits = 0): string {
  const shown = Number(value.toFixed(digits));
  const category = new Intl.PluralRules(lang).select(shown);
  const form = category === "one" ? forms[0] : category === "few" ? forms[1] : forms[2];
  return `${createI18n(lang).number(shown, digits)} ${form}`;
}

// ---------------------------------------------------------------- html helpers

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const e = escapeHtml;

/** What a search result shows of a description before it cuts it. */
export const SNIPPET_LENGTH = 155;

/**
 * A page's description for a search result (Faza 47-4): the whole of it when it fits, else its leading
 * sentences that do, else its first sentence cut at a word with an ellipsis. The page's full description
 * stays where length does no harm (the share preview, the structured data).
 */
export function snippet(description: string, limit = SNIPPET_LENGTH): string {
  const text = description.trim();
  if (text.length <= limit) return text;
  // a sentence ends where its mark is followed by a space: "34.1 %" is not two sentences
  let kept = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const next = kept === "" ? sentence : `${kept} ${sentence}`;
    if (next.length > limit) break;
    kept = next;
  }
  if (kept !== "") return kept;
  const cut = text.slice(0, limit - 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > 0 ? cut.slice(0, word) : cut).replace(/[,;:]$/, "")}…`;
}

/**
 * A heading as the fragment of an address: "Odakle Hrvatskoj dolazi plin?" → "odakle-hrvatskoj-dolazi-plin".
 * Letters lose their marks (č → c, đ → d), everything else between words becomes one hyphen.
 */
export function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The page's sections, each heading with an `id` so a single fact has an address of its own (Faza 47-2).
 * Two sections with the same heading get "-2", "-3"; a heading with no letters gets no id.
 */
/** The anchor of each section's heading, numbered when a heading repeats; "" when it has no letters. */
export function sectionIds(sections: readonly { heading: string }[]): string[] {
  const used = new Map<string, number>();
  return sections.map((section) => {
    const base = anchor(section.heading);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return base === "" ? "" : count === 1 ? base : `${base}-${String(count)}`;
  });
}

export function sectionsHtml(sections: readonly { heading: string; html: string }[]): string {
  const ids = sectionIds(sections);
  return sections
    .map((section, index) => {
      const id = ids[index] ? ` id="${ids[index]}"` : "";
      return `<section><h2${id}>${e(section.heading)}</h2>${section.html}</section>`;
    })
    .join("\n");
}

/** "On this page": the sections' headings as links, for the side column of a long page. */
export function contentsNav(sections: readonly { heading: string }[], label: string): string {
  const ids = sectionIds(sections);
  const items = sections
    .map((section, index) =>
      ids[index] ? `<li><a href="#${ids[index]}">${e(section.heading)}</a></li>` : "",
    )
    .join("");
  // a label, not a heading: the page's outline stays the page's own sections
  return `<nav class="toc" aria-label="${e(label)}"><p>${e(label)}</p><ol>${items}</ol></nav>`;
}

export function table(head: string[], rows: string[][]): string {
  const th = head.map((cell) => `<th>${e(cell)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell, i) => (i === 0 ? `<td>${e(cell)}</td>` : `<td class="num">${e(cell)}</td>`)).join("")}</tr>`,
    )
    .join("");
  return scrollable(`<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`, head);
}

/**
 * A table in its own horizontally scrolling box, so a wide table scrolls on a phone without dragging the page;
 * focusable and named (by its columns) for keyboard and screen-reader users.
 */
export function scrollable(tableHtml: string, columns: readonly string[]): string {
  return `<div class="scroll" role="region" tabindex="0" aria-label="${e(columns.join(", "))}">${tableHtml}</div>`;
}

/** A list; `kind` gives it a look of its own in style.ts ("facts": cards of sentences, "links": a grid of links). */
export function list(items: string[], kind?: "facts" | "links"): string {
  return `<ul${kind ? ` class="${kind}"` : ""}>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

/** Steps in their order, numbered on the page and in the Markdown copy. */
export function steps(items: string[]): string {
  return `<ol class="steps">${items.map((item) => `<li>${item}</li>`).join("")}</ol>`;
}

export interface Door {
  href: string;
  title: string;
  /** what the reader will see there */
  text: string;
  /** an inline SVG shown before the title (decoration: hidden from assistive technology) */
  icon?: string;
  /** what the card does, as words at its foot ("Pokreni priču"); the whole card is the link */
  action?: string;
}

/**
 * Links that open the map, as cards (`.doors` in style.ts): the title is the link and the whole card is
 * its target; the line under it says what will be shown. Still a list of links for a reader and a crawler.
 */
export function doors(items: Door[]): string {
  const cards = items.map(
    (item) =>
      `<li>${item.icon ?? ""}<a href="${e(item.href)}">${e(item.title)}</a> <span>${e(item.text)}</span>${
        item.action === undefined ? "" : ` <em>${e(item.action)}</em>`
      }</li>`,
  );
  return `<ul class="doors">${cards.join("")}</ul>`;
}

/**
 * Terms that open one at a time (`.glossary` in style.ts): the reader sees the list of words and opens the
 * one they came for. Plain `<details>`, so it works without script and a crawler reads every definition.
 */
export function glossary(rows: [string, string][]): string {
  const terms = rows.map(
    ([term, text]) => `<details><summary>${e(term)}</summary><p>${e(text)}</p></details>`,
  );
  return `<div class="glossary">${terms.join("")}</div>`;
}

/** One thing to do, set apart from the text around it: a sentence and a link that looks like a button. */
export function callout(
  text: string,
  link: { href: string; label: string; external?: boolean },
  icon = "",
): string {
  const target = link.external === true ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<p class="callout">${icon}<span>${e(text)}</span> <a href="${e(link.href)}"${target}>${e(link.label)}</a></p>`;
}

export function definitions(rows: [string, string][]): string {
  return `<dl>${rows.map(([term, value]) => `<dt>${e(term)}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

/** A table whose first column is already HTML (a name, linked or not) and the rest plain text. */
export function linkedTable(head: string[], rows: [string, ...string[]][]): string {
  const th = head.map((cell) => `<th>${e(cell)}</th>`).join("");
  const body = rows
    .map(
      ([first, ...rest]) =>
        `<tr><td>${first}</td>${rest.map((cell) => `<td class="num">${e(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return scrollable(`<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`, head);
}
