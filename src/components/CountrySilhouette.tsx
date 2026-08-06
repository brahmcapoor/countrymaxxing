import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { geoArea, geoAzimuthalEqualArea, geoCentroid, geoPath } from "d3-geo";
import type { Country } from "../data/countries";
import { isolatedGeometry } from "./mapGeometry";
import { loadFeatures, type CountryFeature } from "./worldTopology";

// Every instance fits its own country to the same nominal box, independent
// of every other instance and of true size — see the module doc below for
// why that's exactly the property "It's Relative" needs.
const BASE_PX = 200;
const VIEWBOX_PADDING_PX = 6;

// Real bug hit playing this: a genuinely scattered multi-island candidate
// (Comoros — three islands spread across most of its own bounding box) at a
// large displayScale (near SizeComparePlay's MAX_DISPLAY_RATIO) rendered as
// an almost-blank card with a stray fragment in one corner — the card's
// overflow-hidden clip was landing between islands, not on a single
// contiguous shape the way it does for a compact country. Reducing to just
// the largest polygon guarantees every silhouette is one contiguous blob
// that clips gracefully at any scale, the same way Chad/Niger/Togo already
// did — a deliberate simplification (outlying islands are dropped from the
// *drawing*, not from the area math driving the actual scale comparison,
// which still uses country.area) in favor of always being legible over
// always being geographically complete, which this fast-paced comparison
// game cares less about than WorldMap does.
function largestPolygonOnly(f: { geometry: unknown }): { type: "Feature"; geometry: unknown } {
  const geometry = f.geometry as { type?: string; coordinates?: unknown[] } | null;
  if (!geometry || geometry.type !== "MultiPolygon") return { type: "Feature", geometry: f.geometry };
  const polygons = (geometry.coordinates ?? []).map((coordinates) => ({ type: "Polygon", coordinates }));
  if (polygons.length <= 1) return { type: "Feature", geometry: f.geometry };
  let best = polygons[0]!;
  let bestArea = -Infinity;
  for (const polygon of polygons) {
    const area = geoArea(polygon as never);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return { type: "Feature", geometry: best };
}

/**
 * Renders one country's shape in isolation — decoupled from WorldMap's
 * shared whole-world projection, which has no notion of a single country's
 * own true relative size (every feature there shares one projection's
 * rotation/scale, fit to whatever's currently in view).
 *
 * Area accuracy comes from two things working together:
 * 1. `geoAzimuthalEqualArea`, not the `geoNaturalEarth1` used everywhere
 *    else in this app — a compromise projection that visibly distorts area
 *    away from the equator, which is fine for a whole-world map but wrong
 *    for a mode whose entire premise is relative size. Azimuthal equal-area
 *    is exact, not just locally low-distortion.
 * 2. Every instance is independently `fitSize`'d to the *same* `BASE_PX`
 *    box regardless of the country's real size — which means, by
 *    construction, every unscaled instance represents the same nominal "1
 *    unit" footprint. The caller-supplied `displayScale` is therefore the
 *    *entire* correction needed to show true relative size: a reference
 *    country renders at `displayScale={1}`, and a candidate's true scale
 *    relative to it is exactly `sqrt(candidate.area / reference.area)` —
 *    see engine.ts's Size Compare section.
 */

interface CountrySilhouetteProps {
  country: Pick<Country, "cca3" | "ccn3" | "capitalLatLng" | "name">;
  /** Scale factor relative to a reference shown at 1 — animates smoothly
   * between values, which is what drives the "reveal true scale" moment. */
  displayScale: number;
  className?: string;
}

export function CountrySilhouette({ country, displayScale, className }: CountrySilhouetteProps) {
  const [features, setFeatures] = useState<CountryFeature[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFeatures().then((f) => {
      if (!cancelled) setFeatures(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const built = useMemo(() => {
    if (!features) return null;
    const raw = features.find((f) => f.id === country.ccn3);
    if (!raw) return null;
    const geometry = largestPolygonOnly(isolatedGeometry(raw, country));
    const centroid = geoCentroid(geometry as never);
    if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) return null;
    const projection = geoAzimuthalEqualArea().rotate([-centroid[0], -centroid[1]]);
    projection.fitSize([BASE_PX, BASE_PX], geometry as never);
    const path = geoPath(projection);
    const d = path(geometry as never);
    if (!d) return null;
    const b = path.bounds(geometry as never) as [[number, number], [number, number]];
    const viewBox = [
      b[0][0] - VIEWBOX_PADDING_PX,
      b[0][1] - VIEWBOX_PADDING_PX,
      b[1][0] - b[0][0] + VIEWBOX_PADDING_PX * 2,
      b[1][1] - b[0][1] + VIEWBOX_PADDING_PX * 2,
    ].join(" ");
    return { d, viewBox };
  }, [features, country]);

  if (!built) {
    return <div className={className} aria-hidden="true" />;
  }

  return (
    <motion.div
      className={className}
      style={{ transformOrigin: "50% 50%" }}
      animate={{ scale: displayScale }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <svg viewBox={built.viewBox} role="img" aria-label={country.name} className="h-full w-full">
        <path d={built.d} fill="currentColor" />
      </svg>
    </motion.div>
  );
}
