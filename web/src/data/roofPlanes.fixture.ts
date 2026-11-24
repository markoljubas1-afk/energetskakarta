import type { RoofPlanes } from "./roofPlanes";

const year = (peak: number): number[][] =>
  Array.from({ length: 12 }, () =>
    Array.from({ length: 24 }, (_, hour) => Math.max(0, 700 - 100 * Math.abs(hour - peak))),
  );

/** One grid point: best 1200 kWh/kWp; south 30° 99 %, east 30° 80 %, flat 92.5 %; east peaks at 10:00. */
export const PLANES: RoofPlanes = {
  version: 1,
  generatedAt: "2026-11-24T22:00:00+00:00",
  source: "PVGIS 5.3 (European Commission, Joint Research Centre), database PVGIS-SARAH3",
  sourceUrl: "https://re.jrc.ec.europa.eu/pvg_tools/en/",
  license: "CC-BY-4.0",
  attribution: "PVGIS © European Communities, 2001-2026",
  systemLossPercent: 14,
  cell: { col: 10, row: 9, lon: 16, lat: 44.5 },
  best: { slopeDeg: 36, azimuthDeg: 0, yearlyKwh: 1200 },
  planes: [
    { id: "S-15", facing: "S", slopeDeg: 15, azimuthDeg: 0, yearlyKwh: 1140, shape: year(12) },
    { id: "S-30", facing: "S", slopeDeg: 30, azimuthDeg: 0, yearlyKwh: 1188, shape: year(12) },
    { id: "S-45", facing: "S", slopeDeg: 45, azimuthDeg: 0, yearlyKwh: 1206, shape: year(12) },
    {
      id: "E-30",
      facing: "E",
      slopeDeg: 30,
      azimuthDeg: -90,
      yearlyKwh: 960,
      shape: year(10),
    },
    {
      id: "flat",
      facing: "flat",
      slopeDeg: 10,
      azimuthDeg: 0,
      yearlyKwh: 1110,
      shape: year(12),
    },
  ],
};
