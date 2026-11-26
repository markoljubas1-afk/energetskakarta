/**
 * Where the map goes to show a country's plants (Faza 57-D). The pipeline draws plants of 10–100 MW and every
 * plan from zoom 7 only (`plant_minzoom` in pipeline/src/energymap/tiles.py), so a button that filters the map
 * to a country's wind farms or plans must also bring the map that close, or it shows an empty country. At
 * zoom 7 a desktop window holds all or most of Croatia; a phone, the middle of it.
 */
import type { CountryCode } from "../domain";

export const SHOW_PLANTS_ZOOM = 7;

/** The middle of each country's mainland, by eye from its extent. */
export const COUNTRY_CENTER: Record<CountryCode, { lng: number; lat: number }> = {
  HR: { lng: 16.2, lat: 44.9 },
  SI: { lng: 14.9, lat: 46.1 },
  HU: { lng: 19.4, lat: 47.2 },
  RS: { lng: 20.8, lat: 44.0 },
  BA: { lng: 17.7, lat: 44.1 },
  ME: { lng: 19.3, lat: 42.8 },
  IT: { lng: 12.6, lat: 42.6 },
  AT: { lng: 14.1, lat: 47.6 },
};
