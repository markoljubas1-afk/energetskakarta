import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { useAsync } from "../app/useAsync";
import { fetchJson } from "../data/current";
import { prepareIndex, search, SearchIndexSchema, type SearchHit } from "../data/search";
import { useI18n } from "../i18n";
import styles from "./SearchBox.module.css";

interface Props {
  indexUrl: string;
  onPick: (hit: SearchHit) => void;
}

/** ARIA 1.2 combobox with a listbox popup; the index is only downloaded after the first focus. */
export function SearchBox({ indexUrl, onPick }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const id = useId();
  const [wanted, setWanted] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [index] = useAsync(wanted ? indexUrl : null, async (signal) =>
    prepareIndex(await fetchJson(indexUrl, SearchIndexSchema, signal)),
  );

  const hits = useMemo(() => (index?.status === "ready" ? search(index.value, query) : []), [index, query]);
  const showList = open && query.trim().length >= 2;

  const pick = (hit: SearchHit): void => {
    onPick(hit);
    setQuery(hit.name);
    setOpen(false);
  };

  const describe = (hit: SearchHit): string => {
    const where = hit.country ? i18n.country(hit.country) : "";
    let what: (string | null)[];
    if (hit.kind === "plant") {
      what = [i18n.technology(hit.technology), hit.capacityMw !== null ? i18n.power(hit.capacityMw) : null];
    } else if (hit.kind === "datacenter") {
      what = [t("kind_datacenter"), hit.powerMw !== null ? i18n.power(hit.powerMw) : null];
    } else if (hit.kind === "city") {
      what = [
        t("kind_city"),
        `${i18n.energy(hit.electricityMwh)}/${t("unitYear")}`,
        String(hit.inventoryYear),
      ];
    } else if (hit.kind === "extraction") {
      what = [t(`extraction_${hit.extractionKind}`), t(`substance_${hit.substance}`)];
    } else {
      what = [
        t("kind_substation"),
        hit.maxVoltageKv !== null ? `${i18n.number(hit.maxVoltageKv)} ${t("unitKv")}` : null,
      ];
    }
    return [...what, where].filter(Boolean).join(", ");
  };

  let status: string | null = null;
  if (showList) {
    if (!index || index.status === "loading") status = t("searchLoading");
    else if (index.status === "error") status = t("searchFailed");
    else if (hits.length === 0) status = t("searchNoResults", { query: query.trim() });
  }

  return (
    <div className={styles.box}>
      <label htmlFor={`${id}-input`} className="visually-hidden">
        {t("searchLabel")}
      </label>
      <Search className={styles.icon} size={16} strokeWidth={1.75} aria-hidden="true" />
      <input
        id={`${id}-input`}
        data-shortcut="search"
        className={styles.input}
        type="search"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("searchPlaceholder")}
        aria-expanded={showList && hits.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && hits[active] ? `${id}-opt-${active}` : undefined}
        value={query}
        onFocus={() => {
          setWanted(true);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            const hit = hits[active];
            if (showList && hit) {
              event.preventDefault();
              pick(hit);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <ul id={`${id}-list`} role="listbox" className={styles.list} hidden={!showList || hits.length === 0}>
        {hits.map((hit, i) => (
          <li
            key={hit.id}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={styles.option}
            // mousedown keeps focus in the input so blur does not close the list first
            onMouseDown={(event) => {
              event.preventDefault();
              pick(hit);
            }}
            onMouseEnter={() => {
              setActive(i);
            }}
          >
            <span className={styles.name}>{hit.name}</span>
            <span className={styles.meta}>{describe(hit)}</span>
          </li>
        ))}
      </ul>
      {status && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
    </div>
  );
}
