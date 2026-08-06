import { feature } from "topojson-client";
import { KOSOVO_RING } from "../data/kosovoGeometry";

export interface CountryFeature {
  type: "Feature";
  id: string; // ccn3
  properties: { name: string };
  geometry: unknown;
}

// Several disputed/dependent territories world-atlas can't assign a real
// ISO 3166-1 numeric code to (Kosovo, Somaliland, Northern Cyprus, the
// Indian Ocean Territories, Siachen Glacier) all come back from topojson
// with `id: undefined` — none of them are in our 197-country set, so this
// id can't be relied on to tell them apart from each other, only to say
// "not a real, joinable country feature." Kosovo is the one exception genuinely
// in our set; KOSOVO_FEATURE below re-attaches its real geometry (see
// kosovoGeometry.ts) to countries.ts's KOSOVO_CCN3 so it joins like any
// other country instead of falling out with the rest of this group.
const KOSOVO_FEATURE: CountryFeature = {
  type: "Feature",
  id: "XKX",
  properties: { name: "Kosovo" },
  geometry: { type: "Polygon", coordinates: [KOSOVO_RING] },
};

// Palau's own topology feature carries a real data error, distinct from the
// id-undefined group above: alongside its actual archipelago (~134.5-134.7°E)
// its MultiPolygon includes a second, tiny (9-point) speck around 131.16°E,
// 3.04°N — in the Molucca Sea near Halmahera, Indonesia, ~600km from any
// real Palauan territory. Not a legitimate remote Palauan island (Palau has
// none out there); just a mis-tagged sliver carried over from the source
// data. Real Palau starts at 133°E, so anything west of that in this one
// feature is the stray piece — dropped rather than rendered or counted
// toward its bounds (it was dragging the current-question ring/auto-zoom
// anchor west into open water, same class of bug as MAP_SCATTERED_TERRITORY
// but from bad geometry rather than real distant land).
const PALAU_CCN3 = "585";
const PALAU_REAL_MIN_LON = 133;

function fixPalauGeometry(f: CountryFeature): CountryFeature {
  const geometry = f.geometry as { type: string; coordinates: [number, number][][][] };
  if (geometry.type !== "MultiPolygon") return f;
  const coordinates = geometry.coordinates.filter((polygon) =>
    polygon[0]!.some(([lon]) => lon >= PALAU_REAL_MIN_LON),
  );
  return { ...f, geometry: { type: "MultiPolygon", coordinates } };
}

let cachedFeatures: CountryFeature[] | null = null;

/** Synchronous check for whether the topology has already been fetched and
 * parsed — lets a caller (WorldMap's own loading-joke delay) tell a genuine
 * first load apart from a cache hit without awaiting loadFeatures() itself. */
export function getCachedFeatures(): CountryFeature[] | null {
  return cachedFeatures;
}

/** Loads, parses, and patches world-atlas's 50m country topology once;
 * every caller (WorldMap, CountrySilhouette) shares the same cached result
 * rather than each re-fetching the ~200KB topology file. */
export async function loadFeatures(): Promise<CountryFeature[]> {
  if (cachedFeatures) return cachedFeatures;
  const topologyModule = await import("world-atlas/countries-50m.json");
  const topology = topologyModule.default as any;
  const geo = feature(topology, topology.objects.countries) as any;
  const raw = geo.features as CountryFeature[];
  cachedFeatures = [
    ...raw.filter((f) => f.id !== undefined).map((f) => (f.id === PALAU_CCN3 ? fixPalauGeometry(f) : f)),
    KOSOVO_FEATURE,
  ];
  return cachedFeatures;
}
