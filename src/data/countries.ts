import raw from "world-countries";
import { capitalCoordinates } from "./capitalCoordinates";

export interface Country {
  name: string;
  altNames: string[];
  capital: string;
  /** All officially-listed capitals (South Africa has three); `capital` is
   * always `capitals[0]` and is what's shown in prompts and lists — but any
   * of these should count as a correct answer. */
  capitals: string[];
  /** [longitude, latitude] of the primary capital. */
  capitalLatLng: [number, number];
  region: string;
  subregion: string;
  cca3: string;
  ccn3: string; // ISO numeric code — join key into world-atlas map topology
  latlng: [number, number];
  borders: string[];
  flag: string;
}

// world-countries flags "independent" per the strict ISO/UN standard (193 UN
// members + Vatican City = 194). Geography trivia conventionally also includes
// these three de facto states, matching the commonly-quizzed count of 197.
const INCLUDE_DESPITE_NOT_INDEPENDENT = new Set(["Kosovo", "Taiwan", "Palestine"]);

// Each of these countries genuinely has two current, officially-recognized
// capital-like seats (constitutional/legislative vs. executive/administrative)
// but world-countries only lists one. The listed one stays primary/displayed
// (capitals[0]); this only widens what's accepted as correct.
const EXTRA_CAPITALS: Record<string, string[]> = {
  LKA: ["Sri Jayawardenepura Kotte"], // Colombo listed; Kotte seats parliament
  BOL: ["La Paz"], // Sucre listed; La Paz seats government
  NLD: ["The Hague"], // Amsterdam listed; The Hague seats government
  SWZ: ["Mbabane"], // Lobamba listed; Mbabane is the administrative capital
  CHL: ["Valparaíso"], // Santiago listed; Valparaíso seats the National Congress
  CIV: ["Abidjan"], // Yamoussoukro listed; Abidjan is the de facto seat of government
  BEN: ["Cotonou"], // Porto-Novo listed; Cotonou seats government
};

// world-countries has a real data error: it lists Sri Lanka and India as
// bordering each other, but they're separated by the Palk Strait — no land
// border exists. Confirmed against src/data/borderLengths.ts's source
// dataset, which (correctly) has no entry for this pair, and cross-checked
// that India's own reference neighbor list omits Sri Lanka too.
const BAD_BORDERS: Record<string, string[]> = {
  LKA: ["IND"],
  IND: ["LKA"],
};

export const countries: Country[] = raw
  .filter(
    (c) =>
      c.capital.length > 0 &&
      (c.independent || INCLUDE_DESPITE_NOT_INDEPENDENT.has(c.name.common)),
  )
  .map((c) => {
    const altNames = Array.from(
      new Set([c.name.official, ...c.altSpellings].filter((n) => n !== c.name.common)),
    );
    return {
      name: c.name.common,
      altNames,
      capital: c.capital[0]!,
      capitals: [...c.capital, ...(EXTRA_CAPITALS[c.cca3] ?? [])],
      capitalLatLng: capitalCoordinates[c.cca3] ?? (c.latlng as [number, number]),
      region: c.region,
      subregion: c.subregion,
      cca3: c.cca3,
      ccn3: c.ccn3,
      latlng: c.latlng as [number, number],
      borders: c.borders.filter((b) => !BAD_BORDERS[c.cca3]?.includes(b)),
      flag: c.flag,
    };
  });

export const regions = Array.from(new Set(countries.map((c) => c.region))).sort();
