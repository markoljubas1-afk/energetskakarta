/** Message keys for things named in more than one place, so every place names them the same way. */
import type { DownloadKey } from "../domain";
import type { MessageKey } from "./hr";

/** Label of each data file: the download menu and the change report use it. */
export const DOWNLOAD_LABELS: Record<DownloadKey, MessageKey> = {
  lines: "downloadLines",
  substations: "downloadSubstations",
  plants: "downloadPlants",
  pipelines: "downloadPipelines",
  datacenters: "downloadDatacenters",
  chargers: "downloadChargers",
  distribution_lines: "downloadDistributionLines",
  distribution_substations: "downloadDistributionSubstations",
  cities: "downloadCities",
  extraction: "downloadExtraction",
};
