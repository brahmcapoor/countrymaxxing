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
  /** km², from world-countries — metropolitan/mainland figure for the
   * MAP_SCATTERED_TERRITORY countries (France, Netherlands, Chile, Tonga),
   * not mainland+overseas-territory total; confirmed against the isolated
   * silhouette used for "It's Relative" (e.g. France 551,695 km² matches
   * metropolitan France, not the ~633,000 km² including French Guiana etc). */
  area: number;
}

// world-countries flags "independent" per the strict ISO/UN standard (193 UN
// members + Vatican City = 194). Geography trivia conventionally also includes
// these three de facto states, matching the commonly-quizzed count of 197.
const INCLUDE_DESPITE_NOT_INDEPENDENT = new Set(["Kosovo", "Taiwan", "Palestine"]);

// Kosovo has no ISO 3166-1 numeric code (not universally recognized), so
// world-countries leaves ccn3 "" — unlike every other country here, whose
// ccn3 is a real numeric id doubling as the join key into world-atlas's map
// topology. An empty string is still a technically-valid, technically-unique
// Map key, so most ccn3-keyed lookups happened to limp along regardless, but
// it collided with WorldMap.tsx's own KOSOVO_FEATURE substitute id and read
// as a missing/placeholder value everywhere else that treats ccn3 as opaque.
// XKX is the temporary/user-assigned ISO 3166-1 alpha-3 code multiple
// international bodies (the EU, SWIFT) already use for Kosovo in exactly
// this situation — WorldMap.tsx's KOSOVO_FEATURE uses the same id so the two
// join up.
const KOSOVO_CCN3 = "XKX";

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

// A handful of country common names are conventionally spoken/written with a
// leading "the" ("the United Kingdom," "the Bahamas") — not a generalizable
// grammar rule (compare "Ivory Coast," "Czechia," which take none), so this
// is a hand-picked list, same idea as EXTRA_CAPITALS/BAD_BORDERS above. Use
// withArticle() wherever a country name is embedded in a full sentence
// ("What is the capital of ___?"); a flag+name label/list item reads fine
// without it and shouldn't use this.
const COUNTRIES_WITH_ARTICLE = new Set([
  "ARE", // United Arab Emirates
  "BHS", // Bahamas
  "CAF", // Central African Republic
  "COG", // Republic of the Congo
  "COM", // Comoros
  "GBR", // United Kingdom
  "GMB", // Gambia
  "MDV", // Maldives
  "MHL", // Marshall Islands
  "NLD", // Netherlands
  "PHL", // Philippines
  "SLB", // Solomon Islands
  "USA", // United States
]);

export function withArticle(country: Pick<Country, "cca3" | "name">): string {
  return COUNTRIES_WITH_ARTICLE.has(country.cca3) ? `the ${country.name}` : country.name;
}

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
      ccn3: c.cca3 === "UNK" ? KOSOVO_CCN3 : c.ccn3,
      latlng: c.latlng as [number, number],
      borders: c.borders.filter((b) => !BAD_BORDERS[c.cca3]?.includes(b)),
      flag: c.flag,
      area: c.area,
    };
  });

export const regions = Array.from(new Set(countries.map((c) => c.region))).sort();
