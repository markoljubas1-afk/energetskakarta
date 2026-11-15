/**
 * One menu for passing a chart on (Faza 23): a link straight to it, a picture with its credits, the numbers
 * behind it, a ready citation and the code to embed it. Each card of a page brings what only it knows
 * (title, what is shown, its rows, its canvas); the rest is the same everywhere.
 */
import { Code, Download, Image, Link, Quote, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import { canvasToBlob } from "../map/snapshot";
import { embedCode } from "../panels/ShareMenu";
import { composeChartPicture } from "./chartImage";
import { citations } from "./cite";
import { CSV_BOM, csvFileName, toCsv, type Table } from "./csv";
import { download, fileStem, pictureTheme } from "./download";
import styles from "./ChartShare.module.css";
import { PopoverMenu } from "./PopoverMenu";

export interface ChartShareProps {
  title: string;
  /** what is shown: "Hrvatska · mjesečno" */
  subtitle: string;
  /** the card's id: the link opens the page scrolled to it; empty on the map, whose link is its view */
  anchor?: string;
  /** where the numbers come from */
  sources: readonly string[];
  /** when the data were last updated (ISO) */
  dataDate: string | null;
  /** "Izvor: … · stanje … · site": the card's own source line, also written into the picture */
  sourceLine: string;
  /** exactly the rows and columns the card shows */
  table: () => Table;
  /** the card's chart (null while it shows a table); without it there is no picture to save */
  canvas?: () => HTMLCanvasElement | null;
  /** the value of `ec` that embeds this card alone; without it there is nothing to embed */
  embed?: string | null;
  /** bars at the bottom of the map open the menu upwards */
  placement?: "below" | "above";
  /** Injected in tests; defaults to the browser clipboard. */
  writeClipboard?: (text: string) => Promise<void>;
  /** Injected in tests; defaults to the current time. */
  now?: () => Date;
}

/** The page as it is now (area, unit, range…), without embedding, opened at the card. */
export function chartLink(href: string, anchor: string): string {
  const url = new URL(href);
  url.searchParams.delete("embed");
  url.searchParams.delete("ec");
  url.hash = anchor;
  return url.toString();
}

/** The same view, the one card alone, for an iframe. */
export function chartEmbedUrl(href: string, chart: string): string {
  const url = new URL(href);
  url.searchParams.set("embed", "1");
  url.searchParams.set("ec", chart);
  url.hash = "";
  return url.toString();
}

function defaultClipboard(text: string): Promise<void> {
  if (!("clipboard" in navigator)) return Promise.reject(new Error("no clipboard"));
  return navigator.clipboard.writeText(text);
}

type Status =
  | { kind: "idle" }
  | { kind: "copied"; what: string }
  | { kind: "failed"; text: string }
  | { kind: "note"; text: string };
type Panel = "none" | "cite" | "embed";

const STATUS_FOR_MS = 2500;

export function ChartShare(props: ChartShareProps) {
  const { title, subtitle, anchor = "", sources, dataDate, sourceLine, table, canvas, embed = null } = props;
  const placement = props.placement ?? "below";
  const { writeClipboard = defaultClipboard, now = () => new Date() } = props;
  const i18n = useI18n();
  const { t, lang } = i18n;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status.kind !== "copied") return;
    const timer = setTimeout(() => {
      setStatus({ kind: "idle" });
    }, STATUS_FOR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const link = (): string => chartLink(window.location.href, anchor);
  const copy = (text: string, what: string): void => {
    writeClipboard(text).then(
      () => {
        setStatus({ kind: "copied", what });
      },
      () => {
        setStatus({ kind: "failed", text });
      },
    );
  };
  const slug = `${title} ${subtitle}`;

  const onPicture = (): void => {
    const chart = canvas?.() ?? null;
    if (!chart) {
      setStatus({ kind: "note", text: t("chartImageTable") });
      return;
    }
    setBusy(true);
    const scale = chart.clientWidth > 0 ? chart.width / chart.clientWidth : window.devicePixelRatio || 1;
    let picture: HTMLCanvasElement;
    try {
      picture = composeChartPicture(
        chart,
        { title, subtitle, credits: `${sourceLine} · ${t("appName")}`, link: link() },
        pictureTheme(chart),
        scale,
      );
    } catch (error) {
      console.error("[share] chart picture failed", error);
      setBusy(false);
      setStatus({ kind: "note", text: t("shareImageFailed") });
      return;
    }
    canvasToBlob(picture).then(
      (blob) => {
        download(blob, `${fileStem(slug, now())}.png`);
        setBusy(false);
      },
      (error: unknown) => {
        console.error("[share] chart picture failed", error);
        setBusy(false);
        setStatus({ kind: "note", text: t("shareImageFailed") });
      },
    );
  };

  const onCsv = (): void => {
    const blob = new Blob([CSV_BOM + toCsv(table())], { type: "text/csv;charset=utf-8" });
    download(blob, csvFileName(slug, now()));
  };

  const cite =
    panel === "cite"
      ? citations({
          lang,
          site: t("appName"),
          title: `${title}: ${subtitle}`,
          url: link(),
          sources,
          dataDate,
          accessed: now(),
        })
      : null;
  const code =
    panel === "embed" && embed ? embedCode(chartEmbedUrl(window.location.href, embed), title) : null;
  const toggle = (next: Panel): void => {
    setPanel((current) => (current === next ? "none" : next));
  };

  return (
    <PopoverMenu
      label={t("chartShareLabel", { title })}
      triggerClassName={styles.trigger}
      menuClassName={styles.menu}
      placement={placement}
      trigger={
        <>
          <Share2 size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{t("share")}</span>
        </>
      }
    >
      <button
        type="button"
        className={styles.action}
        onClick={() => {
          copy(link(), t("shareCopied"));
        }}
      >
        <Link size={14} strokeWidth={1.75} aria-hidden="true" />
        {t("chartCopyLink")}
      </button>
      {canvas && (
        <button type="button" className={styles.action} onClick={onPicture} disabled={busy}>
          <Image size={14} strokeWidth={1.75} aria-hidden="true" />
          {busy ? t("shareImageBusy") : t("chartImage")}
        </button>
      )}
      <button type="button" className={styles.action} onClick={onCsv}>
        <Download size={14} strokeWidth={1.75} aria-hidden="true" />
        {t("chartCsv")}
      </button>
      <button
        type="button"
        className={styles.action}
        aria-expanded={panel === "cite"}
        onClick={() => {
          toggle("cite");
        }}
      >
        <Quote size={14} strokeWidth={1.75} aria-hidden="true" />
        {t("chartCite")}
      </button>
      {embed && (
        <button
          type="button"
          className={styles.action}
          aria-expanded={panel === "embed"}
          onClick={() => {
            toggle("embed");
          }}
        >
          <Code size={14} strokeWidth={1.75} aria-hidden="true" />
          {t("chartEmbed")}
        </button>
      )}
      <p className={styles.hint}>{canvas ? t("chartNote") : t("chartNoteNoImage")}</p>

      {cite && (
        <div className={styles.panel}>
          {(
            [
              ["citeText", cite.text],
              ["citeApa", cite.apa],
              ["citeBibtex", cite.bibtex],
            ] as const
          ).map(([key, text]) => (
            <div key={key} className={styles.citation}>
              <div className={styles.citationHead}>
                <span>{t(key)}</span>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    copy(text, t("citeCopied"));
                  }}
                >
                  {t("citeCopy")}
                </button>
              </div>
              {key === "citeBibtex" ? (
                <pre className={styles.code}>{text}</pre>
              ) : (
                <p className={styles.text}>{text}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {code && (
        <div className={styles.panel}>
          <p className={styles.hint}>{t("chartEmbedNote")}</p>
          <textarea
            className={styles.code}
            readOnly
            rows={4}
            value={code}
            aria-label={t("chartEmbed")}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              copy(code, t("shareEmbedCopied"));
            }}
          >
            <Link size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("shareEmbedCopy")}
          </button>
        </div>
      )}

      {status.kind === "copied" && (
        <p className={styles.hint} role="status">
          {status.what}
        </p>
      )}
      {status.kind === "note" && (
        <p className={styles.hint} role="status">
          {status.text}
        </p>
      )}
      {status.kind === "failed" && (
        <p className={styles.hint} role="alert">
          {t("chartCopyFailed")}
          <textarea
            className={styles.code}
            readOnly
            rows={3}
            value={status.text}
            aria-label={t("chartCopyFailed")}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </p>
      )}
    </PopoverMenu>
  );
}
