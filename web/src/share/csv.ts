/**
 * The numbers behind a chart as CSV (Faza 23-4): RFC 4180, comma-separated, numbers as plain decimals
 * ("1234.5", the way spreadsheets and scripts read them anywhere), empty cells for missing values.
 */
import { fileStem } from "./download";

export type Cell = string | number | null;

export interface Table {
  header: readonly string[];
  rows: readonly (readonly Cell[])[];
}

/** UTF-8's byte order mark: without it Excel reads "Hidro" fine but "Ugljen/lignit" with broken č, ć, š. */
export const CSV_BOM = "﻿";

function cell(value: Cell): string {
  if (value === null) return "";
  // no locale formatting, whatever precision the data has (plain decimals at the magnitudes we publish)
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(table: Table): string {
  return [table.header, ...table.rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** "proizvodnja-hrvatska-mjesecno-2026-11-15.csv" */
export const csvFileName = (slug: string, now: Date): string => `${fileStem(slug, now)}.csv`;
