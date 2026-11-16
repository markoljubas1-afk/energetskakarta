/**
 * The "Support and partners" page (Faza 24): how to help an independent open-data project, who supports it,
 * and the rule that supporters do not shape the data. Built only when the SUPPORT switch is on (support.ts);
 * otherwise neither the page nor any link to it exists.
 */
import { createI18n } from "../i18n";
import { PARTNER_ROLES, type Partner, type SupportContent } from "../support";
import { LANGS, type Lang } from "../state/url";
import { homeCrumb, mapLink, PATHS, publisher, type SiteData, type StaticPage } from "./site";
import { escapeHtml as e, list } from "./markup";

const other = (lang: Lang): Lang => (lang === "hr" ? "en" : "hr");

const COPY = {
  hr: {
    title: "Podrška i partneri: kako pomoći GridAtlasu",
    description:
      "GridAtlas je neovisan, besplatan projekt otvorenih podataka. Kako ga podržati: dijeljenjem i citiranjem, podacima, partnerstvom i potporom, i tko ga podržava.",
    heading: "Podrška i partneri",
    linkText: "Podržite projekt",
    lead: [
      "Karta je neovisan projekt otvorenih podataka: besplatna za sve, bez oglasa i bez plaćenih sadržaja.",
      "Održavanje košta (poslužitelji, obrada podataka, razvoj), a svaka podrška pomaže da karta ostane besplatna, točna i ažurna.",
    ],
    shareHeading: "Najjednostavnije: koristite, dijelite i citirajte",
    share:
      "Svaki graf ima gumb „Podijeli”: poveznicu, sliku s izvorom, podatke (CSV), gotov citat i kod za ugradnju. Svaki put kad kartu citirate ili ugradite, više ljudi dođe do provjerenih podataka.",
    shareLinks: { map: "Otvori kartu", energy: "Proizvodnja i potrošnja kroz vrijeme" },
    dataHeading: "Podaci",
    data: "Imate podatke koji nedostaju (postrojenja, mreža, potrošnja) i smijete ih objaviti pod otvorenom licencom? Svaki izvor navodi se uz svaki podatak na karti.",
    partnersHeading: "Partnerstva",
    partners:
      "Fakulteti, udruge, energetske agencije i operatori: zajednički projekti, studentski radovi, prijave na natječaje i nove teme za kartu.",
    donateHeading: "Potpora",
    donate: "Rad na karti možete podržati donacijom:",
    donateLink: "stranica za donacije",
    contactHeading: "Kontakt",
    contact: "Za podatke, partnerstva i potporu pišite na",
    whoHeading: "Tko podržava projekt",
    nobody: "Projekt trenutno nema financijera ni partnera.",
    roles: { funder: "Financijeri", data: "Partneri za podatke", institution: "Partnerske ustanove" },
    since: (date: string) => `od ${date}`,
    independenceHeading: "Neovisnost",
    independence:
      "Financijeri i partneri ne utječu na podatke ni na način njihova prikaza. Podaci dolaze iz otvorenih izvora navedenih uz svaki zapis, a popis svih koji projekt podržavaju uvijek je javan na ovoj stranici.",
  },
  en: {
    title: "Support and partners: how to help GridAtlas",
    description:
      "GridAtlas is an independent, free open-data project. How to support it: by sharing and citing, with data, partnerships and funding, and who supports it.",
    heading: "Support and partners",
    linkText: "Support the project",
    lead: [
      "The map is an independent open-data project: free for everyone, with no ads and nothing behind a paywall.",
      "Keeping it running costs money (servers, data processing, development), and every bit of support helps it stay free, accurate and up to date.",
    ],
    shareHeading: "The simplest way: use it, share it, cite it",
    share:
      "Every chart has a Share button: a link, a picture with its source, the data (CSV), a ready citation and the code to embed it. Every time you cite or embed the map, more people reach checked data.",
    shareLinks: { map: "Open the map", energy: "Generation and load over time" },
    dataHeading: "Data",
    data: "Do you have data the map is missing (plants, grid, consumption) that you may publish under an open licence? Every source is named next to every record on the map.",
    partnersHeading: "Partnerships",
    partners:
      "Universities, associations, energy agencies and operators: joint projects, student theses, grant applications and new topics for the map.",
    donateHeading: "Funding",
    donate: "You can support the work on the map with a donation:",
    donateLink: "donation page",
    contactHeading: "Contact",
    contact: "For data, partnerships and funding, write to",
    whoHeading: "Who supports the project",
    nobody: "The project currently has no funders or partners.",
    roles: { funder: "Funders", data: "Data partners", institution: "Partner institutions" },
    since: (date: string) => `since ${date}`,
    independenceHeading: "Independence",
    independence:
      "Funders and partners have no say over the data or how it is shown. The data comes from the open sources named with every record, and the list of everyone who supports the project is always public on this page.",
  },
};

export const hasSupport = (site: SiteData): boolean => Boolean(site.support);

/** The quiet link other pages carry when the page is on; nothing when it is off. */
export const supportLinks = (site: SiteData, lang: Lang): string[] =>
  hasSupport(site) ? [`<a href="${PATHS[lang].support}">${e(COPY[lang].linkText)}</a>`] : [];

/**
 * "od siječnja 2027." / "since January 2027". Croatian needs the genitive after "od", which Intl only gives
 * with a day ("1. siječnja 2027."), so the day is formatted and taken off again.
 */
function sinceMonth(since: string, lang: Lang): string {
  const [year, month] = since.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
  const locale = createI18n(lang).locale;
  if (lang === "en")
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(date)
    .replace(/^1\.\s*/, "");
}

function partnerItem(partner: Partner, lang: Lang): string {
  const name = partner.url
    ? `<a href="${e(partner.url)}" rel="noopener">${e(partner.name)}</a>`
    : e(partner.name);
  return `${name} (${e(COPY[lang].since(sinceMonth(partner.since, lang)))})`;
}

function page(site: SiteData, support: SupportContent, lang: Lang): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const sections: StaticPage["sections"] = [
    {
      heading: copy.shareHeading,
      html:
        `<p>${e(copy.share)}</p>` +
        list([
          `<a href="${mapLink(lang, {})}">${e(copy.shareLinks.map)}</a>`,
          `<a href="${mapLink(lang, { p: "energy" })}">${e(copy.shareLinks.energy)}</a>`,
        ]),
    },
    { heading: copy.dataHeading, html: `<p>${e(copy.data)}</p>` },
    { heading: copy.partnersHeading, html: `<p>${e(copy.partners)}</p>` },
  ];
  if (support.donate) {
    sections.push({
      heading: copy.donateHeading,
      html: `<p>${e(copy.donate)} <a href="${e(support.donate)}" rel="noopener">${e(copy.donateLink)}</a></p>`,
    });
  }
  if (support.contact) {
    sections.push({
      heading: copy.contactHeading,
      html: `<p>${e(copy.contact)} <a href="mailto:${e(support.contact)}">${e(support.contact)}</a>.</p>`,
    });
  }
  const groups = PARTNER_ROLES.flatMap((role) => {
    const partners = support.partners.filter((p) => p.role === role);
    return partners.length > 0
      ? [`<h3>${e(copy.roles[role])}</h3>${list(partners.map((p) => partnerItem(p, lang)))}`]
      : [];
  });
  sections.push({
    heading: copy.whoHeading,
    html: groups.length > 0 ? groups.join("") : `<p>${e(copy.nobody)}</p>`,
  });
  sections.push({ heading: copy.independenceHeading, html: `<p>${e(copy.independence)}</p>` });

  const path = PATHS[lang].support;
  const funders = support.partners.filter((p) => p.role === "funder");
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].support,
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    lead: copy.lead.map((p) => `<p>${e(p)}</p>`).join(""),
    sections,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: copy.title,
        description: copy.description,
        inLanguage: lang,
        about: {
          ...publisher(site, i18n),
          ...(funders.length > 0
            ? {
                funder: funders.map((p) => ({
                  "@type": "Organization",
                  name: p.name,
                  ...(p.url ? { url: p.url } : {}),
                })),
              }
            : {}),
        },
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [homeCrumb(lang)],
  };
}

/** Both languages, only when the switch is on. */
export function supportPages(site: SiteData): StaticPage[] {
  const support = site.support;
  if (!support) return [];
  return LANGS.map((lang) => page(site, support, lang));
}
