import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { geoBounds, geoCentroid, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { randomLoadingMessage } from "../data/loadingMessages";
import { MAP_EXCLUDE_RENDER } from "../data/mapCoverage";

interface CountryFeature {
  type: "Feature";
  id: string; // ccn3
  properties: { name: string };
  geometry: unknown;
}

let cachedFeatures: CountryFeature[] | null = null;
const MIN_LOADING_MS = 1000; // long enough to actually read the joke

async function loadFeatures(): Promise<CountryFeature[]> {
  if (cachedFeatures) return cachedFeatures;
  const start = Date.now();
  const topologyModule = await import("world-atlas/countries-50m.json");
  const topology = topologyModule.default as any;
  const geo = feature(topology, topology.objects.countries) as any;
  cachedFeatures = geo.features as CountryFeature[];
  // Only stalls the genuine first load — once cached, later mounts return
  // immediately above rather than re-paying this delay every time.
  const remaining = MIN_LOADING_MS - (Date.now() - start);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return cachedFeatures;
}

const WIDTH = 800;
const HEIGHT = 450;
const PADDING = 24;
const LENS_SIZE = 260; // rendered pixel size of the magnifier
const LENS_MAP_RADIUS = 18; // half-width of the map area shown inside the lens, in map units
const BLOWUP_SIZE = 150; // rendered pixel size of the auto-blowup inset
// Map-unit bbox size below which a country gets auto-blown-up. Calibrated
// against real bboxes at this WIDTH/HEIGHT/PADDING (full-world fit): Malta
// 0.79, Maldives 2.49 (genuinely tiny, need it) vs. Denmark 12.7, Austria
// 14.2, Iceland 18.0, Germany 18.3, Finland 22.0 (all normal-sized on a
// world map, don't). 16 sits in the gap between those two clusters.
const SMALL_COUNTRY_THRESHOLD = 16;
const POINT_COUNTRY_RADIUS = 3.5; // marker radius for countries with no polygon shape
// A country whose own bounding box spans more than this many degrees of
// longitude is excluded from the FIT calculation when a region filter is
// active — it still renders, it just doesn't get to force the whole view
// back out to fit it. Only Russia (~171°) is meant to hit this; the
// threshold sits well above the next-widest real countries (USA ~121°,
// France ~118° — overseas territories bundled into one polygon, Canada
// ~88°, Netherlands ~76° — Caribbean territories, same reason) so a
// region-filtered view (e.g. "Americas" only) doesn't crop Canada or the US
// out of frame the way a too-tight 50° cutoff did.
const OUTLIER_SPAN_DEGREES = 130;

// Circular mean of each feature's centroid longitude. A plain min/max bounds
// check breaks on features that cross the antimeridian (e.g. Fiji spans
// -180/180), which forces a whole-world fit even for a tightly focused
// region like Oceania — rotating the projection to center on this mean
// first moves the seam away from the focus area entirely.
function meanLongitude(features: CountryFeature[]): number {
  let x = 0;
  let y = 0;
  for (const f of features) {
    const [lon] = geoCentroid(f as any);
    const rad = (lon * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function longitudeSpan(f: CountryFeature): number {
  const [[minLon], [maxLon]] = geoBounds(f as any);
  const span = maxLon - minLon;
  return span < 0 ? span + 360 : span;
}

function fillClassFor(isCurrent: boolean, isWrong: boolean, isFilled: boolean, inScope: boolean): string {
  if (isCurrent) {
    // The question currently on screen — a warm yellow so it reads as "you
    // are here" and doesn't get lost among already-answered countries.
    // current-pulse gives it a slow idle brightness breathe so it stays
    // easy to spot without demanding attention the way a flashing element
    // would.
    return "fill-cat-yellow stroke-paper-card dark:fill-cat-yellow-dark dark:stroke-paper-card-dark current-pulse";
  }
  if (isWrong) {
    // Answered incorrectly and not yet redeemed — full-strength (not faded
    // like "done") so it stands out as something to come back to. Dark mode
    // uses orange rather than red since red-dark is already "correct" there.
    return "fill-cat-red stroke-paper-card dark:fill-cat-orange-dark dark:stroke-paper-card-dark";
  }
  if (isFilled) {
    // Dark mode matches CountryMaxxing's red accent — vivid against navy.
    // Light mode uses a medium sky blue instead of red or full ink: enough
    // contrast against the pale-blue background to read clearly without
    // going as heavy/dark as the ink text color. WorldMap is only used by
    // this one game today, so this stays a direct value rather than a prop
    // no other caller exists to pass yet.
    // Faded relative to the current-question yellow — "done" should read as
    // settled/lower-priority next to whatever's still being asked about.
    return "fill-cat-blue/65 stroke-paper-card dark:fill-cat-red-dark/65 dark:stroke-paper-card-dark";
  }
  return inScope
    ? "fill-black/10 stroke-border dark:fill-white/14 dark:stroke-border-dark"
    : "fill-black/2 stroke-border/30 dark:fill-white/4 dark:stroke-border-dark/30";
}

type Bounds = [number, number, number, number]; // x0, y0, x1, y1

function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function WorldMap({
  filledCcn3s,
  currentCcn3,
  wrongCcn3s,
  focusCcn3s,
  labelsByCcn3,
  capitalDots,
  pointCountries,
  hintPins,
  autoZoomCcn3,
  alwaysInsetCcn3s,
  className,
}: {
  filledCcn3s: Set<string>;
  /** The country the current question is about, if it's safe to show one
   * (not a spoiler) — rendered in a distinct "you are here" color instead of
   * the regular filled color, even if it's also present in filledCcn3s. */
  currentCcn3?: string;
  /** Answered incorrectly and not yet redeemed by a later correct answer —
   * rendered in its own "needs another look" color, checked before
   * filledCcn3s so a country can't be both. */
  wrongCcn3s?: Set<string>;
  /** Restrict the projection's fit to just these countries (e.g. the active
   * region selection) so a small selection zooms in rather than rendering at
   * whole-world scale. Also used to fade out countries visible in the fit
   * but outside the selection. Falls back to fitting/showing the whole world
   * when omitted, empty, or when none of the ids match the map data. */
  focusCcn3s?: Set<string>;
  /** Country name shown on hover, keyed by ccn3. Omit an id to show nothing
   * for it (e.g. to avoid spoiling an unfound answer). */
  labelsByCcn3?: Map<string, string>;
  /** [longitude, latitude] markers to plot, keyed by ccn3 (e.g. capital
   * cities of countries already found). */
  capitalDots?: Map<string, [number, number]>;
  /** Countries with no polygon in the map data — rendered as a marker at
   * [longitude, latitude] instead, keyed by ccn3. They still participate in
   * fill/hover/hit-testing like any other country. */
  pointCountries?: Map<string, [number, number]>;
  /** [longitude, latitude] markers to plot as a pulsing "dropped pin" —
   * distinct from `capitalDots`'s plain reference dot, meant to actively
   * draw the eye to a small number of specific locations (e.g. Manifest's
   * late-game hint for the last few remaining countries), keyed by ccn3. */
  hintPins?: Map<string, [number, number]>;
  /** If this country's on-screen size is small, show a fixed close-up inset
   * of it (no hover needed) so it isn't a near-invisible sliver at whatever
   * zoom level the region selection landed on. */
  autoZoomCcn3?: string;
  /** Countries that always get the inset regardless of size — for ones whose
   * shape is correct but too spatially sparse to read (e.g. Kiribati's
   * atolls spanning 145° of longitude). The inset fits their own true
   * bounding box rather than zooming tightly in, so what's shown is the
   * real scattered geometry, not an artificially close crop. */
  alwaysInsetCcn3s?: Set<string>;
  className?: string;
}) {
  const [features, setFeatures] = useState<CountryFeature[] | null>(null);
  const [hover, setHover] = useState<{
    mapX: number;
    mapY: number;
    clientX: number;
    clientY: number;
    hoveredId: string | null;
  } | null>(null);
  const [magnifierOn, setMagnifierOn] = useState(false);
  const [autoZoomAnchor, setAutoZoomAnchor] = useState<{ x: number; y: number } | null>(null);
  const [justFilledIds, setJustFilledIds] = useState<Set<string>>(new Set());
  const [loadingMessage] = useState(randomLoadingMessage);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const prevFilledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    loadFeatures().then((f) => {
      if (!cancelled) setFeatures(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!magnifierOn) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMagnifierOn(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [magnifierOn]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Countries that just transitioned from unfilled to filled get a brief
  // pop-in animation instead of an instant color swap — tracked as its own
  // short-lived state rather than baked into fillClassFor, so it clears
  // itself after the animation plays instead of persisting.
  useEffect(() => {
    const prev = prevFilledRef.current;
    const newlyFilled = new Set<string>();
    filledCcn3s.forEach((id) => {
      if (!prev.has(id)) newlyFilled.add(id);
    });
    prevFilledRef.current = filledCcn3s;
    if (newlyFilled.size === 0) return;
    setJustFilledIds(newlyFilled);
    const timeout = setTimeout(() => setJustFilledIds(new Set()), 340);
    return () => clearTimeout(timeout);
  }, [filledCcn3s]);

  const projected = useMemo(() => {
    if (!features) return null;
    const focusFeatures = focusCcn3s ? features.filter((f) => focusCcn3s.has(f.id)) : [];
    const isFocused = focusFeatures.length > 0;
    const fitTarget = isFocused
      ? focusFeatures.filter((f) => longitudeSpan(f) <= OUTLIER_SPAN_DEGREES)
      : features;
    const finalTarget = fitTarget.length > 0 ? fitTarget : isFocused ? focusFeatures : features;

    const projection = geoNaturalEarth1();
    if (isFocused) projection.rotate([-meanLongitude(finalTarget), 0]);
    projection.fitExtent(
      [
        [PADDING, PADDING],
        [WIDTH - PADDING, HEIGHT - PADDING],
      ],
      { type: "FeatureCollection", features: finalTarget } as any,
    );
    return { projection, path: geoPath(projection) };
  }, [features, focusCcn3s]);

  const built = useMemo(() => {
    if (!features || !projected) return null;
    const { path, projection } = projected;
    const path2Ds = new Map<string, Path2D>();
    const bounds = new Map<string, Bounds>();
    const elements = features.map((f, i) => {
      // A point-country override takes full precedence over its real
      // polygon (e.g. Kiribati's actual shape is ~33 imperceptible specks
      // scattered across 145° of longitude) — skip it entirely here.
      if (pointCountries?.has(f.id)) return null;
      // Duplicate/overlapping geometry for a territory not in our country
      // set — see MAP_EXCLUDE_RENDER's comment (Western Sahara over Morocco).
      if (MAP_EXCLUDE_RENDER.has(f.id)) return null;
      const d = path(f as any) ?? undefined;
      if (d) {
        // Some external territories (e.g. Ashmore and Cartier Is.) share their
        // parent country's id with no ISO code of their own — merge into the
        // same hit-test region instead of letting the later feature silently
        // overwrite the earlier one's (e.g. Australia's mainland) shape.
        const existing = path2Ds.get(f.id);
        if (existing) existing.addPath(new Path2D(d));
        else path2Ds.set(f.id, new Path2D(d));

        const b = path.bounds(f as any) as [[number, number], [number, number]];
        const box: Bounds = [b[0][0], b[0][1], b[1][0], b[1][1]];
        const existingBox = bounds.get(f.id);
        bounds.set(f.id, existingBox ? mergeBounds(existingBox, box) : box);
      }
      const inScope = !focusCcn3s || focusCcn3s.has(f.id);
      const popClass = justFilledIds.has(f.id) ? " map-pop-in" : "";
      return (
        <path
          key={`${f.id}-${i}`}
          d={d}
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
          className={
            fillClassFor(
              currentCcn3 !== undefined && f.id === currentCcn3,
              !!wrongCcn3s?.has(f.id),
              filledCcn3s.has(f.id),
              inScope,
            ) + popClass
          }
        />
      );
    });

    const pointElements = pointCountries
      ? Array.from(pointCountries.entries())
          .map(([id, lngLat]) => {
            const point = projection(lngLat);
            if (!point) return null;
            const inScope = !focusCcn3s || focusCcn3s.has(id);
            const box: Bounds = [
              point[0] - POINT_COUNTRY_RADIUS,
              point[1] - POINT_COUNTRY_RADIUS,
              point[0] + POINT_COUNTRY_RADIUS,
              point[1] + POINT_COUNTRY_RADIUS,
            ];
            bounds.set(id, box);
            const popClass = justFilledIds.has(id) ? " map-pop-in" : "";
            return (
              <circle
                key={`point-${id}`}
                cx={point[0]}
                cy={point[1]}
                r={POINT_COUNTRY_RADIUS}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
                className={
                  fillClassFor(
                    currentCcn3 !== undefined && id === currentCcn3,
                    !!wrongCcn3s?.has(id),
                    filledCcn3s.has(id),
                    inScope,
                  ) + popClass
                }
              />
            );
          })
          .filter((el): el is NonNullable<typeof el> => el !== null)
      : [];

    const dotElements = capitalDots
      ? Array.from(capitalDots.entries()).map(([id, lngLat]) => {
          const point = projection(lngLat);
          if (!point) return null;
          return (
            <circle
              key={`dot-${id}`}
              cx={point[0]}
              cy={point[1]}
              r={2.2}
              className="fill-white stroke-ink dark:stroke-ink-dark"
              strokeWidth={0.6}
            />
          );
        })
      : [];

    const pinElements = hintPins
      ? Array.from(hintPins.entries()).map(([id, lngLat]) => {
          const point = projection(lngLat);
          if (!point) return null;
          return (
            <g key={`pin-${id}`}>
              <circle
                cx={point[0]}
                cy={point[1]}
                r={4.5}
                className="pin-pulse fill-cat-violet dark:fill-cat-violet-dark"
              />
              <circle
                cx={point[0]}
                cy={point[1]}
                r={2.4}
                strokeWidth={0.7}
                vectorEffect="non-scaling-stroke"
                className="fill-cat-violet stroke-paper-card dark:fill-cat-violet-dark dark:stroke-paper-card-dark"
              />
            </g>
          );
        })
      : [];

    return { elements, pointElements, dotElements, pinElements, path2Ds, bounds };
  }, [
    features,
    projected,
    filledCcn3s,
    currentCcn3,
    wrongCcn3s,
    focusCcn3s,
    capitalDots,
    pointCountries,
    hintPins,
    justFilledIds,
  ]);

  const autoZoomBounds = autoZoomCcn3 ? built?.bounds.get(autoZoomCcn3) : undefined;
  const autoZoomSize = autoZoomBounds
    ? Math.max(autoZoomBounds[2] - autoZoomBounds[0], autoZoomBounds[3] - autoZoomBounds[1])
    : 0;
  const isAlwaysInset = !!autoZoomCcn3 && !!alwaysInsetCcn3s?.has(autoZoomCcn3);
  const showAutoZoom = !!autoZoomBounds && (isAlwaysInset || autoZoomSize < SMALL_COUNTRY_THRESHOLD);
  const autoZoomCenterX = autoZoomBounds ? (autoZoomBounds[0] + autoZoomBounds[2]) / 2 : 0;
  const autoZoomCenterY = autoZoomBounds ? (autoZoomBounds[1] + autoZoomBounds[3]) / 2 : 0;
  const autoZoomCenter = [autoZoomCenterX, autoZoomCenterY];
  // A "sparse" country fits its own true (possibly large) bounding box in
  // full; a genuinely small-and-compact one gets a fixed close-up padding.
  const autoZoomRadius = isAlwaysInset ? autoZoomSize / 2 + 10 : Math.max(autoZoomSize / 2 + 6, 10);

  // Tracks the auto-zoomed country's real on-screen position (via the main
  // map SVG's screen CTM, same technique as updateHover's inverse) so the
  // inset can float directly above it instead of sitting in a fixed corner
  // disconnected from what it's showing. Recomputed on resize and on any
  // scroll (capture-phase, since the map's own portrait-mode horizontal
  // scroll container is a descendant, not the window).
  useEffect(() => {
    if (!showAutoZoom) {
      setAutoZoomAnchor(null);
      return;
    }
    function updateAnchor() {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = autoZoomCenterX;
      pt.y = autoZoomCenterY;
      const screenPt = pt.matrixTransform(ctm);
      setAutoZoomAnchor({ x: screenPt.x, y: screenPt.y });
    }
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
    };
  }, [showAutoZoom, autoZoomCenterX, autoZoomCenterY]);

  if (!features || !built) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-sm text-ink-soft dark:text-ink-soft-dark"
        style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
      >
        {loadingMessage}
      </div>
    );
  }

  function hitTest(mapX: number, mapY: number): string | null {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !built) return null;
    for (const [id, p2d] of built.path2Ds) {
      if (ctx.isPointInPath(p2d, mapX, mapY)) return id;
    }
    if (pointCountries) {
      for (const [id, lngLat] of pointCountries) {
        const point = projected?.projection(lngLat);
        if (!point) continue;
        const dx = point[0] - mapX;
        const dy = point[1] - mapY;
        if (Math.sqrt(dx * dx + dy * dy) <= POINT_COUNTRY_RADIUS + 2) return id;
      }
    }
    return null;
  }

  function updateHover(e: ReactPointerEvent<SVGSVGElement>) {
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const loc = pt.matrixTransform(ctm.inverse());
      setHover({ mapX: loc.x, mapY: loc.y, clientX, clientY, hoveredId: hitTest(loc.x, loc.y) });
    });
  }

  const hoveredLabel = hover?.hoveredId ? labelsByCcn3?.get(hover.hoveredId) : undefined;

  return (
    <div className="relative h-full">
      {/* Only the map itself scrolls (for the portrait/narrow case) — overlays
          below are positioned relative to this stable outer box instead, so
          they don't inherit the inner scroll container's coordinate space. */}
      <div className="h-full overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className={`bg-paper dark:bg-paper-dark ${magnifierOn ? "cursor-none" : ""} ${className ?? ""}`}
          onPointerMove={updateHover}
          onPointerLeave={() => setHover(null)}
        >
          {built.elements}
          {built.pointElements}
          {built.dotElements}
          {built.pinElements}
        </svg>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <button
        type="button"
        onClick={() => setMagnifierOn((v) => !v)}
        title={magnifierOn ? "Turn off magnifier" : "Turn on magnifier"}
        aria-pressed={magnifierOn}
        // top-14 rather than top-2 — every play screen overlays its own
        // status pills (score, timer, sound toggle...) along the very top
        // edge, so sitting right under the corner collides with them.
        className={`absolute right-2 top-14 rounded-full border px-2 py-1 text-xs transition-colors ${
          magnifierOn
            ? "border-transparent bg-cat-red text-white dark:bg-cat-red-dark"
            : "border-border bg-paper-card text-ink-soft hover:text-ink dark:border-border-dark dark:bg-paper-card-dark dark:text-ink-soft-dark dark:hover:text-ink-dark"
        }`}
      >
        🔍
      </button>

      {showAutoZoom &&
        autoZoomAnchor &&
        (() => {
          const circleRadius = BLOWUP_SIZE / 2;
          const gap = 64; // distance from the anchor dot to the circle's near edge
          const circleCenterX = Math.min(
            Math.max(autoZoomAnchor.x, circleRadius + 8),
            window.innerWidth - circleRadius - 8,
          );
          const circleCenterY = Math.max(autoZoomAnchor.y - BLOWUP_SIZE - gap, 68) + circleRadius;

          // Classic cartography "detail bubble": two lines from the real spot
          // fanning out to touch the circle tangentially, rather than one
          // line straight into its center — right-triangle relation between
          // the anchor, the circle's center, and each tangent point (radius
          // ⊥ tangent line) gives the angle to offset by at the center.
          const dx = autoZoomAnchor.x - circleCenterX;
          const dy = autoZoomAnchor.y - circleCenterY;
          const centerToAnchor = Math.sqrt(dx * dx + dy * dy);
          const baseAngle = Math.atan2(dy, dx);
          const tangentOffset = centerToAnchor > circleRadius ? Math.acos(circleRadius / centerToAnchor) : 0;
          const tangentPoints = [baseAngle + tangentOffset, baseAngle - tangentOffset].map((angle) => [
            circleCenterX + circleRadius * Math.cos(angle),
            circleCenterY + circleRadius * Math.sin(angle),
          ]);

          return (
            <>
              <svg
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 z-30 h-full w-full overflow-visible"
              >
                {tangentPoints.map(([tx, ty], i) => (
                  <line
                    key={i}
                    x1={autoZoomAnchor.x}
                    y1={autoZoomAnchor.y}
                    x2={tx}
                    y2={ty}
                    className="stroke-cat-red dark:stroke-cat-red-dark"
                    strokeWidth={1.5}
                  />
                ))}
              </svg>
              {/* Marks the country's actual on-screen spot, so the lens
                  reads as "zoomed in from here" rather than a floating
                  panel with no relation to what it's showing. */}
              <span
                aria-hidden="true"
                className="pointer-events-none fixed z-30 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cat-red shadow-[0_0_0_1.5px_white] dark:bg-cat-red-dark dark:shadow-[0_0_0_1.5px_black]"
                style={{ left: autoZoomAnchor.x, top: autoZoomAnchor.y }}
              />
              <div
                // Circular, matching the magnifier lens's shape/border
                // treatment. Clamped so it can't drift off-screen or up
                // under the top status pills row.
                className="pointer-events-none fixed z-30 overflow-hidden rounded-full border-2 border-cat-red shadow-lg dark:border-cat-red-dark"
                style={{
                  width: BLOWUP_SIZE,
                  height: BLOWUP_SIZE,
                  left: circleCenterX,
                  top: circleCenterY,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <svg
                  viewBox={`${autoZoomCenter[0] - autoZoomRadius} ${autoZoomCenter[1] - autoZoomRadius} ${autoZoomRadius * 2} ${autoZoomRadius * 2}`}
                  className="h-full w-full bg-paper dark:bg-paper-dark"
                >
                  {built.elements}
                  {built.pointElements}
                </svg>
              </div>
            </>
          );
        })()}

      {hoveredLabel && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-paper dark:bg-ink-dark dark:text-paper-dark"
          style={{
            left: hover!.clientX,
            top: hover!.clientY - (magnifierOn ? LENS_SIZE / 2 + 28 : 24),
          }}
        >
          {hoveredLabel}
        </div>
      )}

      {magnifierOn && hover && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-cat-red shadow-lg dark:border-cat-red-dark"
          style={{
            width: LENS_SIZE,
            height: LENS_SIZE,
            left: hover.clientX,
            top: hover.clientY,
          }}
        >
          <svg
            viewBox={`${hover.mapX - LENS_MAP_RADIUS} ${hover.mapY - LENS_MAP_RADIUS} ${LENS_MAP_RADIUS * 2} ${LENS_MAP_RADIUS * 2}`}
            className="h-full w-full bg-paper dark:bg-paper-dark"
          >
            {built.elements}
            {built.pointElements}
            {built.dotElements}
            {built.pinElements}
          </svg>
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cat-red shadow-[0_0_0_1.5px_white] dark:bg-cat-red-dark dark:shadow-[0_0_0_1.5px_black]" />
        </div>
      )}
    </div>
  );
}
