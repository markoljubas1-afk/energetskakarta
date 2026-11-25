/**
 * What the downloadable database may be used for (decision 2026-11-08, tasks/todo.md Faza 17): the database is
 * ODbL, but it contains TransitionZero Solar Asset Mapper records (via Global Energy Monitor) under
 * CC BY-NC 4.0, so the download as a whole is for non-commercial use. Every record names its own licence
 * (provenance), so records without CC-BY-NC-4.0 stay usable commercially under ODbL.
 */
export const DATA_LICENSE = {
  data: "ODbL-1.0",
  url: "https://opendatacommons.org/licenses/odbl/1-0/",
  use: "non-commercial (as a whole)",
  nonCommercialUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  note: "Attribution required. The database is ODbL 1.0 but contains TransitionZero Solar Asset Mapper records under CC BY-NC 4.0, so the download as a whole is for non-commercial use only. Each record names its licence; records that are not CC-BY-NC-4.0 may be used commercially under ODbL. Other parts: Global Energy Monitor CC BY 4.0, Covenant of Mayors/JRC CC BY 4.0, EMODnet open.",
} as const;

/**
 * The terms each source sets for reusing its figures (decision 2026-11-25, tasks/todo.md Faza 53): a data set
 * built on them points at those terms as its `license` and states no licence of the site's own. ENTSO-E puts
 * only part of its data under CC BY 4.0 (generation, actual load and prices are not on its list), so the link
 * is to its terms of use, not to CC BY; HEP ODS publishes no terms, so its impressum (© HEP d.d.) stands in.
 */
export const SOURCE_TERMS = {
  entsoe: "https://transparencyplatform.zendesk.com/hc/en-us/article_attachments/40921869376401",
  entsog: "https://transparency.entsog.eu/pdf/TRA0394_20161115_ENTSOG_TP_TC_of_Use_Rev_2_KNS_LG_KNS.pdf",
  gieAgsi: "https://agsi.gie.eu/data-usage",
  hepOds: "https://www.hep.hr/ods/impressum/588",
  osm: "https://opendatacommons.org/licenses/odbl/1-0/",
  ccBy: "https://creativecommons.org/licenses/by/4.0/",
} as const;

/** schema.org: both licences, and the condition in words. */
export const DATASET_LICENSE = {
  license: [DATA_LICENSE.url, DATA_LICENSE.nonCommercialUrl],
  conditionsOfAccess:
    "ODbL 1.0 with attribution; contains CC BY-NC 4.0 records, so non-commercial use only as a whole. Each record names its licence.",
} as const;
