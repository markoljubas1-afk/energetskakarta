/**
 * A chart as a picture to pass on (Faza 23-2): the chart on the theme's background, with its title and what
 * it shows above, and the source, the date of the data, the site and the link below. Everything a reader needs
 * to trust and find the chart is in the pixels, so it survives being forwarded or posted.
 */
import { wrapText } from "../map/snapshot";

export interface ChartPictureText {
  title: string;
  /** what is shown: "Hrvatska · mjesečno" */
  subtitle: string;
  /** "Izvor: ENTSO-E Transparency Platform · stanje 14. 11. 2026. · GridAtlas" */
  credits: string;
  /** the permalink, written out */
  link: string;
  /** what a reader must know beside the figures (Croatia's half of Krško), above the credits */
  note?: string | null;
}

export interface PictureTheme {
  background: string;
  ink: string;
  muted: string;
  font: string;
}

/** Heights of the parts, in device pixels; pure, so the layout can be checked without a canvas. */
export function pictureLayout(
  scale: number,
  creditLines: number,
  noteLines = 0,
): { pad: number; header: number; footer: number } {
  const pad = 16 * scale;
  const header = pad + 16 * scale * 1.3 + 4 * scale + 12 * scale * 1.3 + 10 * scale;
  const note = noteLines > 0 ? 6 * scale + noteLines * 10.5 * scale * 1.4 : 0;
  const footer = 12 * scale + note + (creditLines + 1) * 10.5 * scale * 1.4 + pad;
  return { pad, header, footer };
}

/** `scale` is the device pixel ratio the chart was drawn at, so text comes out at its size on screen. */
export function composeChartPicture(
  chart: HTMLCanvasElement,
  text: ChartPictureText,
  theme: PictureTheme,
  scale: number,
): HTMLCanvasElement {
  const output = document.createElement("canvas");
  const draw = output.getContext("2d");
  if (!draw) throw new Error("2D canvas is not available");
  const credit = 10.5 * scale;
  const width = chart.width + 2 * 16 * scale;
  draw.font = `${String(credit)}px ${theme.font}`;
  const measure = (s: string): number => draw.measureText(s).width;
  const lines = wrapText(text.credits, width - 2 * 16 * scale, measure);
  const noteLines = text.note ? wrapText(text.note, width - 2 * 16 * scale, measure) : [];
  const { pad, header, footer } = pictureLayout(scale, lines.length, noteLines.length);

  output.width = width;
  output.height = Math.ceil(header + chart.height + footer);
  // resizing resets the context: set everything again
  draw.fillStyle = theme.background;
  draw.fillRect(0, 0, output.width, output.height);
  draw.textBaseline = "top";
  draw.fillStyle = theme.ink;
  draw.font = `600 ${String(16 * scale)}px ${theme.font}`;
  draw.fillText(text.title, pad, pad);
  draw.fillStyle = theme.muted;
  draw.font = `${String(12 * scale)}px ${theme.font}`;
  draw.fillText(text.subtitle, pad, pad + 16 * scale * 1.3 + 4 * scale);
  draw.drawImage(chart, pad, header);

  let y = header + chart.height + 12 * scale;
  draw.font = `${String(credit)}px ${theme.font}`;
  if (noteLines.length > 0) {
    // in ink, not muted: it changes how the figures are read
    draw.fillStyle = theme.ink;
    for (const line of noteLines) {
      draw.fillText(line, pad, y);
      y += credit * 1.4;
    }
    y += 6 * scale;
    draw.fillStyle = theme.muted;
  }
  for (const line of lines) {
    draw.fillText(line, pad, y);
    y += credit * 1.4;
  }
  draw.fillStyle = theme.ink;
  draw.fillText(text.link, pad, y);
  return output;
}
