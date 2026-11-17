import { Code, Image, Link, Send, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import type { MapApi } from "../map/MapView";
import { snapshotFileName } from "../map/snapshot";
import { download } from "../share/download";
import { PopoverMenu } from "../share/PopoverMenu";
import styles from "./StatusBar.module.css";

interface Props {
  /** null until the map is up; the picture button waits for it */
  map: MapApi | null;
  /** Injected in tests; defaults to the browser clipboard. */
  writeClipboard?: (text: string) => Promise<void>;
  /** Injected in tests; defaults to the current time. */
  now?: () => Date;
  /**
   * The device's own share sheet (WhatsApp, Viber, mail...), where the browser has one: phones mostly.
   * null hides the button. Injected in tests; defaults to navigator.share.
   */
  nativeShare?: ((data: ShareData) => Promise<void>) | null;
}

type Copy = { kind: "idle" } | { kind: "done" } | { kind: "failed"; url: string };
type Picture = { kind: "idle" } | { kind: "busy" } | { kind: "failed" };
type Embed = { kind: "closed" } | { kind: "open"; copied: boolean };

/** The iframe a host page pastes: this view, in embed mode, lazy, with a title for screen readers. */
export function embedCode(pageUrl: string, title: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set("embed", "1");
  const safe = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<iframe src="${safe(url.toString())}" title="${safe(title)}" width="100%" height="520" style="border:0;border-radius:12px" loading="lazy" allow="fullscreen"></iframe>`;
}

const COPIED_FOR_MS = 2500;

function defaultClipboard(text: string): Promise<void> {
  if (!("clipboard" in navigator)) return Promise.reject(new Error("no clipboard"));
  return navigator.clipboard.writeText(text);
}

function defaultNativeShare(): ((data: ShareData) => Promise<void>) | null {
  if (typeof navigator.share !== "function") return null;
  return (data) => navigator.share(data);
}

/** Send or copy the current link, or save the view as a picture with its credits. */
export function ShareMenu({
  map,
  writeClipboard = defaultClipboard,
  now = () => new Date(),
  nativeShare = defaultNativeShare(),
}: Props) {
  const { t } = useI18n();
  const [copy, setCopy] = useState<Copy>({ kind: "idle" });
  const [picture, setPicture] = useState<Picture>({ kind: "idle" });
  const [embed, setEmbed] = useState<Embed>({ kind: "closed" });

  useEffect(() => {
    if (copy.kind !== "done") return;
    const timer = setTimeout(() => {
      setCopy({ kind: "idle" });
    }, COPIED_FOR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copy]);

  const onCopy = (): void => {
    const url = window.location.href;
    writeClipboard(url).then(
      () => {
        setCopy({ kind: "done" });
      },
      () => {
        setCopy({ kind: "failed", url });
      },
    );
  };

  const onSend = (): void => {
    if (!nativeShare) return;
    nativeShare({ title: t("appName"), url: window.location.href }).catch((error: unknown) => {
      // closing the sheet without sending is the visitor's choice, not a failure
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("[share] the share sheet failed", error);
    });
  };

  const onPicture = (): void => {
    if (!map) return;
    setPicture({ kind: "busy" });
    map.snapshot().then(
      (blob) => {
        download(blob, snapshotFileName(now()));
        setPicture({ kind: "idle" });
      },
      (error: unknown) => {
        console.error("[share] snapshot failed", error);
        setPicture({ kind: "failed" });
      },
    );
  };

  return (
    <PopoverMenu
      label={t("share")}
      triggerClassName={styles.trigger}
      menuClassName={styles.menu}
      placement="above"
      trigger={
        <>
          <Share2 size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.wide}>{t("share")}</span>
        </>
      }
    >
      <ul>
        {nativeShare && (
          <li>
            <button type="button" className={styles.action} onClick={onSend}>
              <Send size={14} strokeWidth={1.75} aria-hidden="true" />
              {t("shareSend")}
            </button>
          </li>
        )}
        <li>
          <button type="button" className={styles.action} onClick={onCopy}>
            <Link size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("shareCopyLink")}
          </button>
          {copy.kind === "done" && (
            <p className={styles.hint} role="status">
              {t("shareCopied")}
            </p>
          )}
          {copy.kind === "failed" && (
            <p className={styles.hint} role="alert">
              {t("shareCopyFailed")}
              <input
                className={styles.linkField}
                type="text"
                readOnly
                value={copy.url}
                aria-label={t("shareCopyLink")}
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
              />
            </p>
          )}
        </li>
        <li>
          <button
            type="button"
            className={styles.action}
            aria-expanded={embed.kind === "open"}
            onClick={() => {
              setEmbed((current) =>
                current.kind === "open" ? { kind: "closed" } : { kind: "open", copied: false },
              );
            }}
          >
            <Code size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("shareEmbed")}
          </button>
          {embed.kind === "open" && (
            <div className={styles.hint}>
              <p className={styles.hint}>{t("shareEmbedNote")}</p>
              <textarea
                className={styles.linkField}
                readOnly
                rows={4}
                value={embedCode(window.location.href, t("appName"))}
                aria-label={t("shareEmbed")}
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
              />
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  writeClipboard(embedCode(window.location.href, t("appName"))).then(
                    () => {
                      setEmbed({ kind: "open", copied: true });
                    },
                    () => {
                      setEmbed({ kind: "open", copied: false });
                    },
                  );
                }}
              >
                <Link size={14} strokeWidth={1.75} aria-hidden="true" />
                {embed.copied ? t("shareEmbedCopied") : t("shareEmbedCopy")}
              </button>
            </div>
          )}
        </li>
        <li>
          <button
            type="button"
            className={styles.action}
            onClick={onPicture}
            disabled={map === null || picture.kind === "busy"}
          >
            <Image size={14} strokeWidth={1.75} aria-hidden="true" />
            {picture.kind === "busy" ? t("shareImageBusy") : t("shareImage")}
          </button>
          <p className={styles.hint} role={picture.kind === "failed" ? "alert" : undefined}>
            {picture.kind === "failed" ? t("shareImageFailed") : t("shareImageNote")}
          </p>
        </li>
      </ul>
    </PopoverMenu>
  );
}
