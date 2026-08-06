import { geoBounds } from "d3-geo";
import { MAP_SCATTERED_TERRITORY } from "../data/mapCoverage";
import type { Country } from "../data/countries";

/** A GeoJSON-ish feature the map renders — see WorldMap.tsx's CountryFeature. */
interface GeometryFeature {
  geometry: unknown;
}

/** Radius used to trim a MAP_SCATTERED_TERRITORY country down to its
 * capital's own cluster for bounds purposes — deliberately tighter than
 * FOCUS_GROUP_RADIUS_DEGREES (8°, tuned for keeping a whole close
 * archipelago together in one inset). At 8° Tonga's other real island
 * groups (Ha'apai ~0.3°, Vava'u ~2.8° from the capital) would all still
 * count as "near," right back to the same off-center bbox this exists to
 * fix. 2° keeps Tongatapu+Ha'apai together (genuinely close) while dropping
 * Vava'u, and doesn't risk clipping a large contiguous mainland (France,
 * Chile) — the capital always sits inside its own mainland polygon's
 * bounding box regardless of the country's real width, so this only ever
 * affects whether a *separate* polygon counts as near, never the mainland
 * one itself. Shared by WorldMap.tsx (bounds-only, via boundsFocusByCcn3)
 * and CountrySilhouette.tsx (full isolated render, via isolatedGeometry). */
export const BOUNDS_FOCUS_RADIUS_DEGREES = 2;

/** How far from its focus point (a country's capital) a polygon can sit and
 * still count as part of the same island group — see geometryNearPoint. 8°
 * is wide enough to hold a real archipelago together (Cape Verde spans ~2.6°,
 * Kiribati's Gilbert chain ~5.3°) and far tighter than the gaps between a
 * scattered country's separate groups (Kiribati's Gilbert → Phoenix jump is
 * ~13°, Gilbert → Line ~20°). */
export const FOCUS_GROUP_RADIUS_DEGREES = 8;

/** Angular distance (0-180°) from `lon` to the longitude interval
 * `[start, end]`, which may wrap the antimeridian (geoBounds reports such an
 * interval with start > end). 0 when the longitude is inside it. */
function lonDistanceToInterval(lon: number, start: number, end: number): number {
  const span = end - start < 0 ? end - start + 360 : end - start;
  const offset = (((lon - start) % 360) + 360) % 360;
  if (offset <= span) return 0;
  return Math.min(offset - span, 360 - offset);
}

/** The individual polygons a feature is made of — a scattered archipelago is
 * one MultiPolygon feature, but each island group needs measuring separately.
 */
function polygonsOf(f: GeometryFeature): unknown[] {
  const geometry = f.geometry as { type?: string; coordinates?: unknown[] } | null;
  if (!geometry) return [];
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates ?? []).map((coordinates) => ({ type: "Polygon", coordinates }));
  }
  if (geometry.type === "Polygon") return [geometry];
  return [];
}

/** Whether the projection's seam runs through this feature's own longitude
 * range, i.e. whether it renders split across both edges of the map.
 *
 * The seam sits at the antimeridian of whatever longitude the view is rotated
 * to (`rotationLon`; 0 for an unrotated whole-world fit). A feature it cuts
 * gets polygons at the far left *and* far right of the map, so the merged
 * bounding box that falls out of `path.bounds` spans the entire map width and
 * its center lands somewhere the country has nothing to do with. Real bug this
 * was written for: an Africa + Oceania session rotates the view to ~27°E,
 * putting the seam at ~153°W — straight through Kiribati — so Kiribati's box
 * came out 752 units wide (of an 800-unit map) centered over the DR Congo.
 */
export function crossesProjectionSeam(f: GeometryFeature, rotationLon: number): boolean {
  const [[minLon], [maxLon]] = geoBounds(f as never);
  const span = maxLon - minLon < 0 ? maxLon - minLon + 360 : maxLon - minLon;
  const seamOffset = (((rotationLon + 180 - minLon) % 360) + 360) % 360;
  return seamOffset > 0 && seamOffset < span;
}

/** The part of a feature clustered around `focus` ([longitude, latitude], in
 * practice a country's capital) — the polygons within
 * FOCUS_GROUP_RADIUS_DEGREES of it, as a standalone feature — or null if none
 * are (a focus point nowhere near any of the country's own geometry, which
 * shouldn't happen but shouldn't crash either).
 *
 * For a compact country this is the whole thing and nothing changes. For a
 * scattered one (Kiribati's 19 atolls strung across 39° of longitude and
 * three separate island groups) it's the one group worth pointing a reader at:
 * small enough to zoom to legibly, guaranteed not to straddle the seam, and
 * where the capital — the thing One Stop is usually asking about — actually
 * is.
 */
export function geometryNearPoint(
  f: GeometryFeature,
  focus: [number, number],
  radiusDegrees: number = FOCUS_GROUP_RADIUS_DEGREES,
): { type: "Feature"; geometry: { type: "MultiPolygon"; coordinates: unknown[] } } | null {
  const [focusLon, focusLat] = focus;
  const near = polygonsOf(f).filter((polygon) => {
    const [[minLon, minLat], [maxLon, maxLat]] = geoBounds(polygon as never);
    const lonDistance = lonDistanceToInterval(focusLon, minLon, maxLon);
    const latDistance = Math.max(0, minLat - focusLat, focusLat - maxLat);
    return Math.max(lonDistance, latDistance) <= radiusDegrees;
  });
  if (near.length === 0) return null;
  return {
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: near.map((polygon) => (polygon as { coordinates: unknown }).coordinates),
    },
  };
}

/** The geometry a standalone silhouette (CountrySilhouette.tsx) should
 * render for `country` — its full feature, except for MAP_SCATTERED_TERRITORY
 * countries, which get trimmed to just the mainland cluster around the
 * capital the same way WorldMap's boundsFocusByCcn3 already does (France's
 * full topology feature includes French Guiana/Réunion/Mayotte thousands of
 * km away; rendering that whole feature as one shape, or fitting a
 * projection to its bounds, would produce a shape and scale nothing like
 * "France" as this game's country.area figure — metropolitan-only — means).
 * Falls back to the full feature if isolating around the capital somehow
 * finds nothing (shouldn't happen — the capital is always inside its own
 * mainland polygon — but shouldn't crash the renderer either). */
export function isolatedGeometry(
  f: GeometryFeature,
  country: Pick<Country, "cca3" | "capitalLatLng">,
): GeometryFeature {
  if (!MAP_SCATTERED_TERRITORY.has(country.cca3)) return f;
  return geometryNearPoint(f, country.capitalLatLng, BOUNDS_FOCUS_RADIUS_DEGREES) ?? f;
}
