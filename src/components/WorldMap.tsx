import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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

// Pinch/wheel zoom range and the scale a double-tap/double-click jumps to.
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

// Momentum: how fast a released pan glide decays (exponential, per ms — see
// startMomentum), and the release-velocity thresholds (px/ms) below which no
// glide starts, and below which a running one is considered stopped. Release
// velocity itself is clamped to MAX_FLING_SPEED so a spurious huge delta
// (e.g. a synthetic/misbehaving pointer event) can't send it flying.
const MOMENTUM_FRICTION_PER_MS = 0.998;
const MOMENTUM_MIN_SPEED = 0.05;
const MOMENTUM_STOP_SPEED = 0.02;
const MAX_FLING_SPEED = 3;

// Long-press (touch only — mouse already has real hover): how long a still
// single finger must stay down before it counts as a "peek" rather than the
// start of a pan, and how far it's allowed to drift in that window before
// it's treated as a pan/scroll attempt instead.
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 10;

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

// Summary-screen "difficulty tint" mode — see reviewTierByCcn3 below.
// Mutually exclusive with the play-mode current/wrong/filled coloring
// (a country is never rendered in both modes at once), so this is a
// completely separate palette rather than another branch of fillClassFor.
function reviewFillClassFor(tier: 0 | 1 | 2 | 3, inScope: boolean): string {
  switch (tier) {
    case 3: // 2+ misses, or given up on
      return "fill-cat-red stroke-paper-card dark:fill-cat-red-dark dark:stroke-paper-card-dark";
    case 2: // exactly 1 miss — yellow, not orange: orange sits only ~10-15°
      // of hue away from red (worse in dark mode, ~5°), reading as barely
      // distinguishable "different shades of red-orange" rather than a
      // clear step down in severity. Yellow keeps the familiar traffic-
      // light green/yellow/red progression with real hue separation from
      // both neighbors.
      return "fill-cat-yellow stroke-paper-card dark:fill-cat-yellow-dark dark:stroke-paper-card-dark";
    case 1: // right first try, every time
      return "fill-cat-green/70 stroke-paper-card dark:fill-cat-green-dark/70 dark:stroke-paper-card-dark";
    default: // not asked this session
      return inScope
        ? "fill-black/10 stroke-border dark:fill-white/14 dark:stroke-border-dark"
        : "fill-black/2 stroke-border/30 dark:fill-white/4 dark:stroke-border-dark/30";
  }
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
    // like "done") so it stands out as something to come back to. Red in
    // both themes: it's the near-universal "this one's a problem" color, and
    // reusing it for "done" (an earlier version of this dark-mode palette
    // did, to match CountryMaxxing's own red accent) reads as backwards —
    // a correct answer shouldn't share its color with a miss.
    return "fill-cat-red stroke-paper-card dark:fill-cat-red-dark dark:stroke-paper-card-dark";
  }
  if (isFilled) {
    // Blue in both themes — "done," not tied to either theme's accent
    // color, so it can't collide with red's "needs another look" meaning.
    // Faded relative to the current-question yellow — "done" should read as
    // settled/lower-priority next to whatever's still being asked about.
    return "fill-cat-blue/65 stroke-paper-card dark:fill-cat-blue-dark/65 dark:stroke-paper-card-dark";
  }
  return inScope
    ? "fill-black/10 stroke-border dark:fill-white/14 dark:stroke-border-dark"
    : "fill-black/2 stroke-border/30 dark:fill-white/4 dark:stroke-border-dark/30";
}

type Bounds = [number, number, number, number]; // x0, y0, x1, y1

function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

// Pinch-to-zoom / pan state, applied to the map svg as a CSS
// `translate(x, y) scale(s)` (transform-origin 0 0). getScreenCTM already
// folds CSS transforms in, so hover/hit-testing and the auto-zoom anchor
// (both CTM-based) keep working unmodified at any scale/pan.
interface MapTransform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY_TRANSFORM: MapTransform = { scale: 1, x: 0, y: 0 };

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Layout info for the pannable svg, captured once at the start of a
// gesture (or freshly for a one-shot action like double-click) and reused
// for its whole duration — it reflects layout, not the live transform, and
// re-measuring mid-gesture would read a DOM rect that hasn't visually
// caught up with rapid successive transform updates yet.
interface MapLayoutInfo {
  basePosX: number; // screen position the untransformed content's (0,0) sits at
  basePosY: number;
  naturalWidth: number; // content size before any scale is applied
  naturalHeight: number;
  viewRect: DOMRect; // the clipping viewport's screen rect
}

function measureLayout(svg: SVGSVGElement, container: HTMLElement, current: MapTransform): MapLayoutInfo {
  const rect = svg.getBoundingClientRect();
  return {
    basePosX: rect.left - current.x,
    basePosY: rect.top - current.y,
    naturalWidth: rect.width / current.scale,
    naturalHeight: rect.height / current.scale,
    viewRect: container.getBoundingClientRect(),
  };
}

// Keeps the content point under (anchorX, anchorY) fixed under
// (targetX, targetY) as scale changes to nextScale — shared by pinch
// (anchor = gesture-start midpoint, target = the live midpoint) and
// wheel-zoom (anchor === target === cursor, which doesn't move within a
// single tick).
function zoomTowards(
  layout: MapLayoutInfo,
  current: MapTransform,
  anchorX: number,
  anchorY: number,
  targetX: number,
  targetY: number,
  nextScale: number,
): MapTransform {
  const u = (anchorX - layout.basePosX - current.x) / current.scale;
  const v = (anchorY - layout.basePosY - current.y) / current.scale;
  return {
    scale: nextScale,
    x: targetX - layout.basePosX - u * nextScale,
    y: targetY - layout.basePosY - v * nextScale,
  };
}

// Keeps the scaled content covering the viewport (no empty gap at an edge)
// by clamping pan, centering it on any axis where it's now smaller than
// the viewport instead.
function clampTransform(layout: MapLayoutInfo, candidate: MapTransform): MapTransform {
  const scale = clampNum(candidate.scale, MIN_SCALE, MAX_SCALE);
  const scaledW = layout.naturalWidth * scale;
  const scaledH = layout.naturalHeight * scale;
  const { viewRect, basePosX, basePosY } = layout;

  const x =
    scaledW <= viewRect.width
      ? viewRect.left - basePosX + (viewRect.width - scaledW) / 2
      : clampNum(candidate.x, viewRect.right - scaledW - basePosX, viewRect.left - basePosX);

  const y =
    scaledH <= viewRect.height
      ? viewRect.top - basePosY + (viewRect.height - scaledH) / 2
      : clampNum(candidate.y, viewRect.bottom - scaledH - basePosY, viewRect.top - basePosY);

  return { scale, x, y };
}

export function WorldMap({
  filledCcn3s,
  currentCcn3,
  wrongCcn3s,
  reviewTierByCcn3,
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
  /** Summary-screen "how hard was this one this session" tint, keyed by
   * ccn3 — 0 (or absent) = not asked, 1 = right first try every time, 2 =
   * missed once, 3 = missed 2+ times or given up on. When present, this
   * completely replaces the current/wrong/filled coloring for every
   * feature (a play session and a review map are never shown at once). */
  reviewTierByCcn3?: Map<string, 0 | 1 | 2 | 3>;
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const prevFilledRef = useRef<Set<string>>(new Set());

  // Pinch-to-zoom / drag-to-pan. transformRef mirrors the state synchronously
  // (updated in the same call as setTransform) so gesture handlers always see
  // the live value even mid-gesture, before React has committed a re-render —
  // reading `transform` (state) directly from a handler risks a stale value
  // across rapid successive pointermove events.
  const [transform, setTransform] = useState<MapTransform>(IDENTITY_TRANSFORM);
  const transformRef = useRef<MapTransform>(IDENTITY_TRANSFORM);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    transform: MapTransform;
    layout: MapLayoutInfo;
    distance: number;
    mid: { x: number; y: number };
  } | null>(null);
  const panStartRef = useRef<{ transform: MapTransform; layout: MapLayoutInfo; client: { x: number; y: number } } | null>(
    null,
  );
  // Release-velocity tracking for pan momentum, in px/ms — refreshed on
  // every pan pointermove, read once when the gesture ends.
  const velocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const lastSampleRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const momentumRafRef = useRef<number | null>(null);
  // Long-press-to-peek (touch only): the pointer being timed, and the timer
  // itself.
  const longPressStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  function applyTransform(next: MapTransform) {
    transformRef.current = next;
    setTransform(next);
  }

  function cancelMomentum() {
    if (momentumRafRef.current !== null) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
  }

  // Glides the pan after a flick, decelerating exponentially and clamping to
  // bounds every frame — hitting a bound zeroes that axis's velocity (stop at
  // the wall, no bounce) rather than fighting the clamp indefinitely.
  function startMomentum(layout: MapLayoutInfo, vx: number, vy: number) {
    cancelMomentum();
    const velocity = { x: clampNum(vx, -MAX_FLING_SPEED, MAX_FLING_SPEED), y: clampNum(vy, -MAX_FLING_SPEED, MAX_FLING_SPEED) };
    let lastT: number | null = null;
    function step(now: number) {
      const dt = lastT === null ? 0 : now - lastT;
      lastT = now;
      const candidate: MapTransform = {
        scale: transformRef.current.scale,
        x: transformRef.current.x + velocity.x * dt,
        y: transformRef.current.y + velocity.y * dt,
      };
      const clamped = clampTransform(layout, candidate);
      applyTransform(clamped);
      if (clamped.x !== candidate.x) velocity.x = 0;
      if (clamped.y !== candidate.y) velocity.y = 0;
      const decay = Math.pow(MOMENTUM_FRICTION_PER_MS, dt);
      velocity.x *= decay;
      velocity.y *= decay;
      if (Math.hypot(velocity.x, velocity.y) < MOMENTUM_STOP_SPEED) {
        momentumRafRef.current = null;
        return;
      }
      momentumRafRef.current = requestAnimationFrame(step);
    }
    momentumRafRef.current = requestAnimationFrame(step);
  }

  function clearLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }

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
      if (momentumRafRef.current !== null) cancelAnimationFrame(momentumRafRef.current);
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
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

  // A new fit (initial load, or a region-filter change) re-projects the
  // whole map — any manual zoom/pan from before is now pointed at the wrong
  // area, so reset it. Not triggered by answer-progress changes (filled/
  // current/wrong sets) since `projected` doesn't depend on those.
  useEffect(() => {
    cancelMomentum();
    applyTransform(IDENTITY_TRANSFORM);
  }, [projected]);

  // Ctrl+wheel (explicit, or how browsers report a trackpad pinch gesture)
  // zooms the map instead of the page — React's onWheel is passive by
  // default, so preventDefault there silently no-ops; a manually attached
  // listener with passive:false is required to actually stop page zoom.
  useEffect(() => {
    const svg = svgRef.current;
    const container = scrollContainerRef.current;
    if (!svg || !container) return;
    function handleWheelNative(e: WheelEvent) {
      if (!svg || !container) return;
      cancelMomentum();
      if (e.ctrlKey) {
        e.preventDefault();
        const layout = measureLayout(svg, container, transformRef.current);
        const factor = Math.exp(-e.deltaY * 0.01);
        const nextScale = clampNum(transformRef.current.scale * factor, MIN_SCALE, MAX_SCALE);
        const zoomed = zoomTowards(layout, transformRef.current, e.clientX, e.clientY, e.clientX, e.clientY, nextScale);
        applyTransform(clampTransform(layout, zoomed));
        return;
      }
      if (transformRef.current.scale > 1) {
        // Two-finger trackpad scroll pans the zoomed-in map rather than the
        // (non-scrolling, h-dvh) page.
        e.preventDefault();
        const layout = measureLayout(svg, container, transformRef.current);
        const next: MapTransform = {
          scale: transformRef.current.scale,
          x: transformRef.current.x - e.deltaX,
          y: transformRef.current.y - e.deltaY,
        };
        applyTransform(clampTransform(layout, next));
      }
    }
    svg.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheelNative);
  }, [projected]);

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
            (reviewTierByCcn3
              ? reviewFillClassFor(reviewTierByCcn3.get(f.id) ?? 0, inScope)
              : fillClassFor(
                  currentCcn3 !== undefined && f.id === currentCcn3,
                  !!wrongCcn3s?.has(f.id),
                  filledCcn3s.has(f.id),
                  inScope,
                )) + popClass
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
                  (reviewTierByCcn3
                    ? reviewFillClassFor(reviewTierByCcn3.get(id) ?? 0, inScope)
                    : fillClassFor(
                        currentCcn3 !== undefined && id === currentCcn3,
                        !!wrongCcn3s?.has(id),
                        filledCcn3s.has(id),
                        inScope,
                      )) + popClass
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
    reviewTierByCcn3,
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

  // In portrait (see the outer div's overflow-x-auto below), the map renders
  // wider than the viewport and only scrolls horizontally into view — a
  // highlighted country off in the unscrolled part is otherwise invisible on
  // mobile without the player manually dragging the map. Center the current
  // question's country in the scroll container whenever it changes, reusing
  // the same bounds this memo already computes for the auto-zoom inset. A
  // no-op on desktop, where the map already fits without horizontal scroll
  // (maxScroll <= 0).
  useEffect(() => {
    const container = scrollContainerRef.current;
    const bounds = autoZoomCcn3 ? built?.bounds.get(autoZoomCcn3) : undefined;
    if (!container || !bounds) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll <= 0) return;
    const centerX = (bounds[0] + bounds[2]) / 2;
    const targetScroll = (centerX / WIDTH) * container.scrollWidth - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, Math.min(maxScroll, targetScroll)), behavior: "smooth" });
  }, [autoZoomCcn3, built]);

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

  function setHoverAt(clientX: number, clientY: number) {
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

  function updateHover(e: ReactPointerEvent<SVGSVGElement>) {
    setHoverAt(e.clientX, e.clientY);
  }

  const hoveredLabel = hover?.hoveredId ? labelsByCcn3?.get(hover.hoveredId) : undefined;

  // Ends tracking for one pointer. If a pinch (2 fingers) drops to 1, hands
  // off to a pan using the remaining finger instead of just stopping —
  // lifting the first finger of a pinch shouldn't abruptly end the gesture.
  // If it was the last finger of an active pan and it was still moving,
  // starts a momentum glide instead of stopping dead.
  function endGesture(pointerId: number) {
    pointersRef.current.delete(pointerId);
    clearLongPress();
    const svg = svgRef.current;
    const container = scrollContainerRef.current;
    if (pointersRef.current.size < 2) pinchStartRef.current = null;

    if (pointersRef.current.size === 0) {
      const wasPanning = panStartRef.current !== null;
      panStartRef.current = null;
      if (wasPanning && svg && container) {
        const { vx, vy } = velocityRef.current;
        if (Math.hypot(vx, vy) > MOMENTUM_MIN_SPEED) {
          startMomentum(measureLayout(svg, container, transformRef.current), vx, vy);
        }
      }
      return;
    }

    if (pointersRef.current.size === 1 && transformRef.current.scale > 1 && svg && container) {
      const remaining = Array.from(pointersRef.current.values())[0];
      panStartRef.current = {
        transform: transformRef.current,
        layout: measureLayout(svg, container, transformRef.current),
        client: remaining,
      };
      lastSampleRef.current = { x: remaining.x, y: remaining.y, t: performance.now() };
      velocityRef.current = { vx: 0, vy: 0 };
    } else {
      panStartRef.current = null;
    }
  }

  function handleGesturePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelMomentum();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture is best-effort — keeps move/up events flowing here even if the
    // pointer strays outside the element mid-gesture, but its absence
    // shouldn't abort tracking (older browsers / non-standard pointer ids
    // can reject it).
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore — see comment above
    }
    const svg = svgRef.current;
    const container = scrollContainerRef.current;
    if (!svg || !container) return;

    if (pointersRef.current.size === 2) {
      clearLongPress();
      const pts = Array.from(pointersRef.current.values());
      pinchStartRef.current = {
        transform: transformRef.current,
        layout: measureLayout(svg, container, transformRef.current),
        distance: pointerDistance(pts[0], pts[1]),
        mid: pointerMidpoint(pts[0], pts[1]),
      };
      panStartRef.current = null;
    } else if (pointersRef.current.size === 1 && transformRef.current.scale > 1) {
      panStartRef.current = {
        transform: transformRef.current,
        layout: measureLayout(svg, container, transformRef.current),
        client: { x: e.clientX, y: e.clientY },
      };
      lastSampleRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      velocityRef.current = { vx: 0, vy: 0 };
    }

    // Long-press-to-peek: only meaningful for a lone touch — a mouse already
    // has real hover, and a 2nd finger just turned this into a pinch (which
    // cleared the timer above).
    if (e.pointerType === "touch" && pointersRef.current.size === 1) {
      longPressStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      const pointerId = e.pointerId;
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        const pos = pointersRef.current.get(pointerId);
        if (pos) setHoverAt(pos.x, pos.y);
      }, LONG_PRESS_MS);
    }
  }

  function handleGesturePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pointersRef.current.has(e.pointerId)) {
      updateHover(e);
      return;
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const longPress = longPressStartRef.current;
    if (longPress && longPress.pointerId === e.pointerId) {
      const moved = Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y);
      if (moved > LONG_PRESS_MOVE_TOLERANCE) clearLongPress();
    }

    const pinch = pinchStartRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const pts = Array.from(pointersRef.current.values()).slice(0, 2);
      const dist = pointerDistance(pts[0], pts[1]);
      const mid = pointerMidpoint(pts[0], pts[1]);
      const nextScale = clampNum(pinch.transform.scale * (dist / pinch.distance), MIN_SCALE, MAX_SCALE);
      const zoomed = zoomTowards(pinch.layout, pinch.transform, pinch.mid.x, pinch.mid.y, mid.x, mid.y, nextScale);
      applyTransform(clampTransform(pinch.layout, zoomed));
      return;
    }

    const pan = panStartRef.current;
    if (pan && pointersRef.current.size === 1) {
      const next: MapTransform = {
        scale: pan.transform.scale,
        x: pan.transform.x + (e.clientX - pan.client.x),
        y: pan.transform.y + (e.clientY - pan.client.y),
      };
      applyTransform(clampTransform(pan.layout, next));

      // Light smoothing (not just the raw last-two-samples delta) so one
      // irregularly-spaced event right before release can't dominate the
      // fling speed.
      const now = performance.now();
      const last = lastSampleRef.current;
      if (last) {
        const dt = now - last.t;
        if (dt > 0) {
          const instVx = (e.clientX - last.x) / dt;
          const instVy = (e.clientY - last.y) / dt;
          velocityRef.current = {
            vx: velocityRef.current.vx * 0.7 + instVx * 0.3,
            vy: velocityRef.current.vy * 0.7 + instVy * 0.3,
          };
        }
      }
      lastSampleRef.current = { x: e.clientX, y: e.clientY, t: now };
      return;
    }

    updateHover(e);
  }

  function handleGesturePointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    endGesture(e.pointerId);
    if (e.pointerType === "touch") setHover(null);
  }

  // Double-click/double-tap: zoom in centered on the tap point, or reset if
  // already zoomed — a discoverable alternative to pinch for mouse users and
  // a quick way out of a zoomed-in state for everyone.
  function handleDoubleClick(e: ReactMouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    const container = scrollContainerRef.current;
    if (!svg || !container) return;
    cancelMomentum();
    const layout = measureLayout(svg, container, transformRef.current);
    if (transformRef.current.scale > 1.01) {
      applyTransform(clampTransform(layout, IDENTITY_TRANSFORM));
    } else {
      const zoomed = zoomTowards(
        layout,
        transformRef.current,
        e.clientX,
        e.clientY,
        e.clientX,
        e.clientY,
        DOUBLE_TAP_SCALE,
      );
      applyTransform(clampTransform(layout, zoomed));
    }
  }

  return (
    <div className="relative h-full">
      {/* Only the map itself scrolls (for the portrait/narrow case) — overlays
          below are positioned relative to this stable outer box instead, so
          they don't inherit the inner scroll container's coordinate space. */}
      <div
        ref={scrollContainerRef}
        className={`h-full ${transform.scale > 1 ? "overflow-hidden" : "overflow-x-auto"}`}
        // pan-x (not none) at rest so the existing portrait native
        // horizontal scroll still works untouched; a 2-finger touch isn't
        // in the allowed action either way, so it still reaches our pinch
        // handler instead of the browser's own page-zoom. Once the user has
        // zoomed in, panning needs to move freely in any direction, so
        // native scroll is switched off in favor of our own drag handling.
        style={{ touchAction: transform.scale > 1 ? "none" : "pan-x" }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className={`bg-paper dark:bg-paper-dark ${magnifierOn ? "cursor-none" : ""} ${className ?? ""}`}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
            // A long touch on the map is a deliberate "peek" gesture, not a
            // request for the OS's own text-selection/callout UI.
            WebkitTouchCallout: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
          onPointerDown={handleGesturePointerDown}
          onPointerMove={handleGesturePointerMove}
          onPointerUp={handleGesturePointerUp}
          onPointerCancel={handleGesturePointerUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={handleDoubleClick}
        >
          {built.elements}
          {built.pointElements}
          {built.dotElements}
          {built.pinElements}
        </svg>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {transform.scale > 1.01 && (
        <button
          type="button"
          onClick={() => {
            cancelMomentum();
            applyTransform(IDENTITY_TRANSFORM);
          }}
          title="Reset zoom"
          // top-14, mirroring the magnifier button on the opposite side —
          // see its comment about clearing every play screen's top status
          // pills row.
          className="absolute left-2 top-14 rounded-full border border-border bg-paper-card px-2 py-1 text-xs text-ink-soft shadow-sm hover:text-ink dark:border-border-dark dark:bg-paper-card-dark dark:text-ink-soft-dark dark:hover:text-ink-dark"
        >
          ↺
        </button>
      )}

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
