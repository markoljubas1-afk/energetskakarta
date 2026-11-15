/** Hands a blob to the browser as a download and releases it afterwards. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // revoke on the next turn: some browsers start the download after click() returns
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** "proizvodnja-hrvatska-mjesecno-2026-11-15": ASCII only, so it survives every system it is sent through. */
export function fileStem(slug: string, now: Date): string {
  const ascii = slug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${ascii}-${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The colours and font a picture is drawn in, read from the page's tokens so it matches the theme. */
export function pictureTheme(element: Element): {
  background: string;
  ink: string;
  muted: string;
  font: string;
} {
  const css = getComputedStyle(element);
  return {
    background: css.getPropertyValue("--surface").trim() || "#eef0f1",
    ink: css.getPropertyValue("--ink").trim() || "#1e262e",
    muted: css.getPropertyValue("--muted").trim() || "#5e6a75",
    font: css.getPropertyValue("--font").trim() || "system-ui, sans-serif",
  };
}
