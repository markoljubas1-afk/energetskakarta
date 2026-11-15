import { Crosshair } from "lucide-react";

import { useAsync } from "../app/useAsync";
import { fetchJson } from "../data/current";
import {
  DiffSchema,
  LAYER_SWITCH,
  summarizeDiff,
  type ChangeKind,
  type DiffExample,
  type DiffLayer,
} from "../data/diff";
import type { LayerKey } from "../domain";
import { useI18n } from "../i18n";
import { DOWNLOAD_LABELS } from "../i18n/labels";
import { Skeleton } from "./Skeleton";
import styles from "./ChangesPanel.module.css";

/** Where a reader wants to go: the example's place, and its id when it still exists in the data. */
export interface Locate {
  id: string | null;
  layer: LayerKey;
  lon: number;
  lat: number;
}

interface Props {
  diffUrl: string;
  onLocate: (target: Locate) => void;
}

const KIND_LABEL = {
  added: "changesAdded",
  changed: "changesChanged",
  removed: "changesRemoved",
} as const satisfies Record<ChangeKind, string>;

const OSM_PREFIX = "osm:";

function osmLink(id: string): string | null {
  return id.startsWith(OSM_PREFIX) ? `https://www.openstreetmap.org/${id.slice(OSM_PREFIX.length)}` : null;
}

export function ChangesPanel({ diffUrl, onLocate }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const [diff, retry] = useAsync(diffUrl, (signal) => fetchJson(diffUrl, DiffSchema, signal));

  if (!diff || diff.status === "loading") {
    return <Skeleton label={t("loadingData")} rows={6} />;
  }
  if (diff.status === "error") {
    return (
      <p className={styles.muted} role="alert">
        {t("changesFailed")}{" "}
        <button type="button" className={styles.link} onClick={retry}>
          {t("retry")}
        </button>
      </p>
    );
  }

  const summary = summarizeDiff(diff.value);
  // "+1 −1": only the kinds that happened, so a row never reads as a wall of zeros
  const figures = (row: { added: number; changed: number; removed: number }) => (
    <span className={styles.figures}>
      {row.added > 0 && <span data-kind="added">+{i18n.number(row.added)}</span>}
      {row.changed > 0 && <span data-kind="changed">~{i18n.number(row.changed)}</span>}
      {row.removed > 0 && <span data-kind="removed">−{i18n.number(row.removed)}</span>}
    </span>
  );
  const total = summary.totals.added + summary.totals.changed + summary.totals.removed;

  const example = (layer: DiffLayer, kind: ChangeKind, item: DiffExample) => {
    const name = item.name ?? t("detailsUnnamed");
    const link = osmLink(item.id);
    const canLocate = item.lon !== undefined && item.lat !== undefined;
    return (
      <li key={`${kind}:${item.id}`} className={styles.example} data-kind={kind}>
        <span className={styles.kind}>{t(KIND_LABEL[kind])}</span>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className={styles.name}>
            {name}
          </a>
        ) : (
          <span className={styles.name}>{name}</span>
        )}
        {canLocate && (
          <button
            type="button"
            className={styles.locate}
            aria-label={`${t("changesLocate")}: ${name}`}
            title={kind === "removed" ? t("changesRemovedHint") : t("changesLocate")}
            onClick={() => {
              onLocate({
                id: kind === "removed" ? null : item.id,
                layer: LAYER_SWITCH[layer],
                lon: item.lon ?? 0,
                lat: item.lat ?? 0,
              });
            }}
          >
            <Crosshair size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className={styles.changes}>
      <h3 className={styles.heading}>{t("changesTitle")}</h3>
      <p className={styles.muted}>
        {summary.since === null ? t("changesFirst") : t("changesSince", { date: i18n.date(summary.since) })}
      </p>

      <dl className={styles.totals}>
        {(["added", "changed", "removed"] as const).map((kind) => (
          <div key={kind} data-kind={kind}>
            <dt>{t(KIND_LABEL[kind])}</dt>
            <dd>{i18n.number(summary.totals[kind])}</dd>
          </div>
        ))}
      </dl>

      {total === 0 ? (
        <p className={styles.muted}>{t("changesNone")}</p>
      ) : (
        <>
          {summary.countries.length > 1 && (
            <section>
              <h4 className={styles.subheading}>{t("changesByCountry")}</h4>
              <ul className={styles.countries}>
                {summary.countries.map((row) => (
                  <li key={row.country}>
                    <span>{i18n.country(row.country)}</span>
                    {figures(row)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.layers.map((row) => (
            <section key={row.layer} className={styles.layer} aria-label={t(DOWNLOAD_LABELS[row.layer])}>
              <h4 className={styles.subheading}>
                {t(DOWNLOAD_LABELS[row.layer])}
                {figures(row)}
              </h4>
              <p className={styles.fine}>{t("changesUnchanged", { count: i18n.number(row.unchanged) })}</p>
              <ul className={styles.examples}>
                {row.examples.map(({ kind, example: item }) => example(row.layer, kind, item))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
