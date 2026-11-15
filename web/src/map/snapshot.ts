/**
 * A PNG of the current view with the attribution written into the picture. The licences of our data
 * (ODbL, CC BY) require the credit to travel with the image, so it is part of the pixels, not of the page.
 */

export interface SnapshotText {
  /** "Regionalna energetska karta · 19. 9. 2026." */
  title: string;
  /** every credit line, joined; wrapped to the width of the picture */
  attribution: string;
}

export interface SnapshotTheme {
  background: string;
  ink: string;
  muted: string;
  font: string;
}

/** Split `text` into lines no wider than `maxWidth` according to `measure`; words are never broken. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** "energetska-karta-2026-09-19-1432.png": sortable, no characters a file system minds. */
export function snapshotFileName(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `energetska-karta-${stamp}.png`;
}

/**
 * Draw the map image with a footer of credits underneath. `scale` is the device pixel ratio the map
 * was rendered at, so text comes out the same physical size as on screen.
 */
export function composeSnapshot(
  map: CanvasImageSource & { width: number; height: number },
  text: SnapshotText,
  theme: SnapshotTheme,
  scale: number,
): HTMLCanvasElement {
  const padding = 10 * scale;
  const titleSize = 12 * scale;
  const creditSize = 10 * scale;
  const lineHeight = creditSize * 1.35;

  const output = document.createElement("canvas");
  const context = output.getContext("2d");
  if (!context) throw new Error("2D canvas is not available");

  // measure first: the footer height depends on how many lines the credits need
  context.font = `${creditSize}px ${theme.font}`;
  const lines = wrapText(text.attribution, map.width - 2 * padding, (s) => context.measureText(s).width);
  const footer = padding + titleSize * 1.4 + lines.length * lineHeight + padding;

  output.width = map.width;
  output.height = map.height + footer;
  const draw = output.getContext("2d");
  if (!draw) throw new Error("2D canvas is not available");
  draw.drawImage(map, 0, 0);
  draw.fillStyle = theme.background;
  draw.fillRect(0, map.height, output.width, footer);
  draw.fillStyle = theme.ink;
  draw.font = `600 ${titleSize}px ${theme.font}`;
  draw.textBaseline = "top";
  draw.fillText(text.title, padding, map.height + padding);
  draw.fillStyle = theme.muted;
  draw.font = `${creditSize}px ${theme.font}`;
  let y = map.height + padding + titleSize * 1.4;
  for (const line of lines) {
    draw.fillText(line, padding, y);
    y += lineHeight;
  }
  return output;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("the picture could not be encoded"));
    }, "image/png");
  });
}
