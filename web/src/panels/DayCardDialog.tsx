import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAsync } from "../app/useAsync";
import type { GasStorage } from "../data/gasStorage";
import { greenCountries } from "../data/greenShare";
import type { Live } from "../data/live";
import { SCOPE_COUNTRIES } from "../domain";
import { useI18n, type I18n } from "../i18n";
import {
  CARD_FORMATS,
  CARD_SIZES,
  dayCard,
  drawDayCard,
  type CardFormat,
  type CardText,
  type DayCard,
} from "../share/dayCard";
import { download, fileStem, pictureTheme } from "../share/download";
import { drawSourcesCard, latestDay, latestMonth, sourcesCountries } from "../share/sourcesCard";
import { loadSources, sourcesSummary, sourcesText } from "../share/sourcesText";
import styles from "./DayCardDialog.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /** today's live figures; null while they are loading or when the build has none */
  live: Live | null;
  /** gas in storage; null while loading, or when there is none: the card then has two figures */
  storage: GasStorage | null;
  now: Date;
  /** where the daily and monthly totals behind the "sources" pictures are read from */
  dataBaseUrl: URL;
  /** the country the card opens with */
  home?: string;
}

/**
 * What the picture shows: the three figures of this moment, or what the electricity of the latest complete
 * day or month was made of (Faza 41).
 */
export const CARD_KINDS = ["figures", "day", "month"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** A picture ready to draw: its words for a screen reader, how it is drawn, and its file's name. */
interface Picture {
  summary: string;
  draw: (ctx: CanvasRenderingContext2D, font: string, format: CardFormat) => void;
  slug: string;
}

/** What the picture says, in the reader's language. Every figure carries the time it is for. */
export function cardText(card: DayCard, i18n: I18n): CardText {
  const { t } = i18n;
  const hour = new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(card.hour),
  );
  const figures = [
    {
      value: String(Math.round(card.share * 100)),
      unit: "%",
      label: t("dayCardShare"),
      note: t("dayCardShareNote", { hour }),
    },
  ];
  if (card.price) {
    figures.push({
      value: i18n.number(card.price.average, 0),
      unit: t("unitEurMwh"),
      label: t("dayCardPrice"),
      note: t("dayCardPriceNote", { hours: card.price.hours }),
    });
  }
  if (card.storage) {
    figures.push({
      value: String(Math.round(card.storage.full)),
      unit: "%",
      label: t("dayCardStorage"),
      note:
        card.storage.facilities === 1
          ? t("dayCardStorageOne", { name: card.storage.name, date: i18n.date(card.storage.day) })
          : t("dayCardStorageMany", { count: card.storage.facilities, date: i18n.date(card.storage.day) }),
    });
  }
  return {
    title: t("dayCardTitle"),
    subtitle: `${i18n.country(card.country)} · ${i18n.date(card.hour.slice(0, 10))}`,
    figures,
    footer: t(card.storage ? "dayCardFooterGas" : "dayCardFooter"),
  };
}

/** The picture in words, for a screen reader and for the test. */
export function cardSummary(text: CardText): string {
  const figures = text.figures.map((f) => `${f.value} ${f.unit} ${f.label} (${f.note})`).join("; ");
  return `${text.title}. ${text.subtitle}: ${figures}. ${text.footer}`;
}

/** The day in three figures as a picture to save and share, in a native modal dialog. */
export function DayCardDialog({ open, onClose, live, storage, now, dataBaseUrl, home = "HR" }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [chosen, setChosen] = useState(home);
  const [failed, setFailed] = useState(false);
  const [format, setFormat] = useState<CardFormat>("wide");
  const [kind, setKind] = useState<CardKind>("figures");
  // the totals are read when a "sources" picture is first asked for, and kept after that
  const [wantSources, setWantSources] = useState(false);
  const [sources] = useAsync(wantSources ? `sources:${dataBaseUrl.href}` : null, (signal) =>
    loadSources(dataBaseUrl, signal),
  );
  const totals = sources?.status === "ready" && sources.value.kind === "ready" ? sources.value : null;

  const countries =
    kind === "figures"
      ? live
        ? greenCountries(live)
        : []
      : totals
        ? sourcesCountries(totals.periods, SCOPE_COUNTRIES)
        : [];
  const country = countries.includes(chosen) ? chosen : (countries[0] ?? chosen);
  let picture: Picture | null = null;
  if (kind === "figures") {
    const card = live ? dayCard(live, storage, country, now) : null;
    if (card) {
      const text = cardText(card, i18n);
      picture = {
        summary: cardSummary(text),
        draw: (ctx, font, shape) => {
          drawDayCard(ctx, text, font, shape);
        },
        slug: `gridatlas-dan-${country}`,
      };
    }
  } else if (totals) {
    const card = kind === "day" ? latestDay(totals.days, country) : latestMonth(totals.periods, country);
    if (card) {
      const text = sourcesText(card, i18n);
      picture = {
        summary: sourcesSummary(text),
        draw: (ctx, font, shape) => {
          drawSourcesCard(ctx, text, font, shape);
        },
        slug: `gridatlas-izvori-${country}-${card.period}`,
      };
    }
  }
  const summary = picture?.summary ?? "";
  const waiting = kind === "figures" ? live === null : sources === null || sources.status === "loading";
  const failedToLoad = kind !== "figures" && sources?.status === "error";

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // the picture is what `summary` says: redraw when the words change
  const drawn = useRef(picture);
  useEffect(() => {
    drawn.current = picture;
  });
  useEffect(() => {
    const element = canvas.current;
    const current = drawn.current;
    if (!open || !element || !current) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    current.draw(ctx, pictureTheme(element).font, format);
  }, [open, summary, format]);

  const save = (): void => {
    const element = canvas.current;
    if (!element) return;
    element.toBlob((blob) => {
      if (!blob) {
        console.error("[share] the day card could not be turned into a picture");
        setFailed(true);
        return;
      }
      setFailed(false);
      const shape = format === "story" ? "-story" : "";
      download(blob, `${fileStem(`${picture?.slug ?? "gridatlas"}${shape}`, now)}.png`);
    }, "image/png");
  };

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="day-card-title" onClose={onClose}>
      <div className={styles.head}>
        <h2 id="day-card-title">{t("dayCardHeading")}</h2>
        <button type="button" className={styles.close} aria-label={t("closeDialog")} onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <label className={styles.country}>
        {t("dayCardKind")}
        <select
          value={kind}
          onChange={(event) => {
            const next = CARD_KINDS.find((each) => each === event.currentTarget.value) ?? "figures";
            setKind(next);
            if (next !== "figures") setWantSources(true);
          }}
        >
          {CARD_KINDS.map((each) => (
            <option key={each} value={each}>
              {t(`dayCardKind_${each}`)}
            </option>
          ))}
        </select>
      </label>
      {countries.length > 0 && (
        <label className={styles.country}>
          {t("dayCardCountry")}
          <select
            value={country}
            onChange={(event) => {
              setChosen(event.currentTarget.value);
            }}
          >
            {countries.map((code) => (
              <option key={code} value={code}>
                {i18n.country(code)}
              </option>
            ))}
          </select>
        </label>
      )}
      {picture ? (
        <>
          <fieldset className={styles.formats}>
            <legend>{t("dayCardFormat")}</legend>
            {CARD_FORMATS.map((each) => (
              <label key={each}>
                <input
                  type="radio"
                  name="day-card-format"
                  checked={format === each}
                  onChange={() => {
                    setFormat(each);
                  }}
                />
                {t(`dayCardFormat_${each}`)}
              </label>
            ))}
          </fieldset>
          <canvas
            ref={canvas}
            className={styles.picture}
            data-format={format}
            width={CARD_SIZES[format].width}
            height={CARD_SIZES[format].height}
            role="img"
            aria-label={summary}
          />
          <button type="button" className={styles.save} onClick={save}>
            <Download size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("dayCardDownload")}
          </button>
          {failed && (
            <p className={styles.note} role="alert">
              {t("dayCardFailed")}
            </p>
          )}
          <p className={styles.note}>{t("dayCardFree")}</p>
        </>
      ) : (
        <p className={styles.note} role="status">
          {t(
            failedToLoad
              ? "sourcesFailed"
              : waiting
                ? "dayCardLoading"
                : kind === "figures"
                  ? "dayCardNone"
                  : "sourcesNone",
          )}
        </p>
      )}
    </dialog>
  );
}
