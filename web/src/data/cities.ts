/** The compact city register `cities.json` (pipeline/src/energymap/products.py, city_register). */
import { z } from "zod";

import { isOneOf, SCOPE_COUNTRIES, SECTORS, type CountryCode, type Sector } from "../domain";

const Row = z.tuple([
  z.string(), // id
  z.string(), // name
  z.string(), // country
  z.number(), // lon
  z.number(), // lat
  z.number().int().nullable(), // population
  z.number().int(), // inventory year
  z.boolean(), // baseline inventory
  z.number(), // electricity MWh
  z.number(), // total MWh
  z.number().int().nullable(), // baseline year
  z.number().nullable(), // baseline electricity MWh
  z.array(z.number().nullable()), // electricity by sector, in the order of `sectors`
]);

export const CityRegisterSchema = z.object({
  version: z.literal(1),
  fields: z.array(z.string()),
  sectors: z.array(z.string()),
  rows: z.array(Row),
});
export type CityRegister = z.infer<typeof CityRegisterSchema>;

export interface CityRow {
  id: string;
  name: string;
  country: CountryCode | null;
  lon: number;
  lat: number;
  population: number | null;
  inventoryYear: number;
  baseline: boolean;
  electricityMwh: number;
  totalMwh: number;
  baselineYear: number | null;
  baselineElectricityMwh: number | null;
  /** only the sectors the city reported */
  electricityBySector: Partial<Record<Sector, number>>;
}

/** Rows as objects, in the file's order (largest electricity first). */
export function cityRows(register: CityRegister): CityRow[] {
  return register.rows.map((row) => {
    const [
      id,
      name,
      country,
      lon,
      lat,
      population,
      year,
      baseline,
      electricity,
      total,
      bYear,
      bEl,
      bySector,
    ] = row;
    const electricityBySector: Partial<Record<Sector, number>> = {};
    register.sectors.forEach((sector, index) => {
      const value = bySector[index];
      if (isOneOf(SECTORS, sector) && typeof value === "number") electricityBySector[sector] = value;
    });
    return {
      id,
      name,
      country: isOneOf(SCOPE_COUNTRIES, country) ? country : null,
      lon,
      lat,
      population,
      inventoryYear: year,
      baseline,
      electricityMwh: electricity,
      totalMwh: total,
      baselineYear: bYear,
      baselineElectricityMwh: bEl,
      electricityBySector,
    };
  });
}
