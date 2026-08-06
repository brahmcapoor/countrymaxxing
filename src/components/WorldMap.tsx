import {
  useEffect,
  useLayoutEffect,
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
import { KOSOVO_RING } from "../data/kosovoGeometry";
import { crossesProjectionSeam, geometryNearPoint } from "./mapGeometry";

interface CountryFeature {
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
const MIN_LOADING_MS = 1000; // long enough to actually read the joke

async function loadFeatures(): Promise<CountryFeature[]> {
  if (cachedFeatures) return cachedFeatures;
  const start = Date.now();
  const topologyModule = await import("world-atlas/countries-50m.json");
  const topology = topologyModule.default as any;
  const geo = feature(topology, topology.objects.countries) as any;
  const raw = geo.features as CountryFeature[];
  cachedFeatures = [
    ...raw.filter((f) => f.id !== undefined).map((f) => (f.id === PALAU_CCN3 ? fixPalauGeometry(f) : f)),
    KOSOVO_FEATURE,
  ];
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
// Radius used to trim a MAP_SCATTERED_TERRITORY country down to its capital's
// own cluster for bounds purposes — deliberately tighter than mapGeometry's
// shared FOCUS_GROUP_RADIUS_DEGREES (8°, tuned for keeping a whole close
// archipelago together in one inset). At 8° Tonga's other real island groups
// (Ha'apai ~0.3°, Vava'u ~2.8° from the capital) would all still count as
// "near," right back to the same off-center bbox this exists to fix. 2°
// keeps Tongatapu+Ha'apai together (genuinely close) while dropping Vava'u,
// and doesn't risk clipping a large contiguous mainland (France, Chile) —
// the capital always sits inside its own mainland polygon's bounding box
// regardless of the country's real width, so this only ever affects whether
// a *separate* polygon counts as near, never the mainland one itself.
const BOUNDS_FOCUS_RADIUS_DEGREES = 2;
// Inside the auto-blowup inset: the rendered size under which an island is
// a smudge rather than a shape, and the radius of the marker that stands in
// for it when it is. Both in rendered pixels — see insetMarkerRadius.
const INSET_MIN_ISLAND_PX = 3;
const INSET_ISLAND_MARKER_PX = 3.5;
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
// Past this scale the map itself is already magnified enough that the lens
// stops being useful — it hides itself (rather than turning the feature off)
// so it reappears automatically on zooming back out, instead of requiring
// another tap on the magnifier button.
const MAGNIFIER_MAX_SCALE = 2;

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

// Shared by both coloring modes below — the "you are here" highlight and
// the "nothing to show yet" default aren't specific to either one, so both
// fillClassFor (the older isCurrent/isWrong/isFilled boolean mode, still
// used by Terra Incognita and Frontiers) and reviewFillClassFor (the tier
// gradient, used by One Stop live and every mode's post-session summary)
// draw from the same two constants instead of each hand-writing them.
const CURRENT_FILL_CLASS =
  "fill-cat-yellow stroke-paper-card dark:fill-cat-yellow-dark dark:stroke-paper-card-dark current-pulse";
function notAskedFillClass(inScope: boolean): string {
  return inScope
    ? "fill-black/10 stroke-border dark:fill-white/14 dark:stroke-border-dark"
    : "fill-black/2 stroke-border/30 dark:fill-white/4 dark:stroke-border-dark/30";
}

// "Difficulty tint" mode — see reviewTierByCcn3 below. Originally
// summary-screen-only; One Stop now also feeds this live (see
// PromptAndAnswerPlay.tsx's tierByCcn3), so a country you've already
// answered recolors immediately instead of staying a flat "done" blue —
// the current question still wins via isCurrent, same priority order
// fillClassFor already used.
//
// A diverging scale, not a 3-step traffic light: neutral gray sits in the
// middle for "not asked this session," and each side ramps in *opacity*
// (same hue) rather than shifting hue — a hue ramp toward orange was tried
// first and dropped, since orange sits only ~10-15° from red (worse in dark
// mode, ~5°) and read as barely distinguishable "shades of red-orange," not
// a clear scale. Opacity has no such collision and reads unambiguously as
// "more/less," which is the actual thing being encoded (attempts taken).
export type ReviewTier = { outcome: "correct" | "wrong"; tries: number };

// Index 0 = 1 try, index 3 = 4+ tries (clamped) — four steps is enough to
// read as a gradient without the classes becoming illegible. Every class
// string here is written out in full (not built from a hue/opacity
// variable) — Tailwind's scanner needs the literal text to generate the
// CSS, same rule palette.ts's Tailwind class maps follow.
const REVIEW_TIER_FILLS = {
  correct: [
    "fill-cat-green/35 stroke-paper-card dark:fill-cat-green-dark/35 dark:stroke-paper-card-dark",
    "fill-cat-green/55 stroke-paper-card dark:fill-cat-green-dark/55 dark:stroke-paper-card-dark",
    "fill-cat-green/75 stroke-paper-card dark:fill-cat-green-dark/75 dark:stroke-paper-card-dark",
    "fill-cat-green stroke-paper-card dark:fill-cat-green-dark dark:stroke-paper-card-dark",
  ],
  wrong: [
    "fill-cat-red/35 stroke-paper-card dark:fill-cat-red-dark/35 dark:stroke-paper-card-dark",
    "fill-cat-red/55 stroke-paper-card dark:fill-cat-red-dark/55 dark:stroke-paper-card-dark",
    "fill-cat-red/75 stroke-paper-card dark:fill-cat-red-dark/75 dark:stroke-paper-card-dark",
    "fill-cat-red stroke-paper-card dark:fill-cat-red-dark dark:stroke-paper-card-dark",
  ],
} as const;
// Exported so ReviewMap.tsx can clamp/weight tries the same way this file
// renders them, and build a legend that matches the real steps exactly
// instead of an idealized continuous gradient that doesn't.
export const REVIEW_TIER_MAX_TRIES = REVIEW_TIER_FILLS.correct.length;

function reviewFillClassFor(isCurrent: boolean, tier: ReviewTier | undefined, inScope: boolean): string {
  if (isCurrent) return CURRENT_FILL_CLASS;
  if (!tier) return notAskedFillClass(inScope); // not asked this session — the scale's neutral midpoint
  const step = Math.min(tier.tries, REVIEW_TIER_MAX_TRIES) - 1;
  return REVIEW_TIER_FILLS[tier.outcome === "correct" ? "correct" : "wrong"][step];
}

/** Everything the two coloring modes below need to color one country, bundled
 * so the three places that draw a country (its polygon, a point country's
 * marker, an inset island marker) can share one call instead of each
 * re-writing the same which-mode-am-I-in ternary. */
interface Coloring {
  filledCcn3s: Set<string>;
  currentCcn3?: string;
  wrongCcn3s?: Set<string>;
  reviewTierByCcn3?: Map<string, ReviewTier>;
  focusCcn3s?: Set<string>;
}

function fillClassForId(id: string, c: Coloring): string {
  const inScope = !c.focusCcn3s || c.focusCcn3s.has(id);
  const isCurrent = c.currentCcn3 !== undefined && id === c.currentCcn3;
  return c.reviewTierByCcn3
    ? reviewFillClassFor(isCurrent, c.reviewTierByCcn3.get(id), inScope)
    : fillClassFor(isCurrent, !!c.wrongCcn3s?.has(id), c.filledCcn3s.has(id), inScope);
}

function fillClassFor(isCurrent: boolean, isWrong: boolean, isFilled: boolean, inScope: boolean): string {
  if (isCurrent) return CURRENT_FILL_CLASS;
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
  return notAskedFillClass(inScope);
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
  alwaysInsetFocusByCcn3,
  boundsFocusByCcn3,
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
  /** "How hard was this one this session" tint, keyed by ccn3 — absent = not
   * asked (the scale's neutral midpoint); otherwise the eventual outcome
   * plus how many tries it took, which sets how far along the green
   * (correct) or red (wrong) side of the scale it lands. Used by every
   * mode's post-session summary map, and live by One Stop's own map while
   * playing (paired with currentCcn3, which still wins for whichever
   * country's on screen right now). When present, this replaces the
   * filledCcn3s/wrongCcn3s coloring for every feature — a screen picks one
   * scheme or the other, never both at once. */
  reviewTierByCcn3?: Map<string, ReviewTier>;
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
   * shape is correct but too spatially sparse to read (e.g. Kiribati's atolls,
   * strung across 39° of longitude in three separate island groups) — each
   * mapped to the [longitude, latitude] the inset should center on, in
   * practice its capital.
   *
   * The inset fits the island group around that point (see
   * `geometryNearPoint`) rather than the country's full bounding box. Fitting
   * the full box was the original design — "show the real scattered geometry,
   * not an artificially close crop" — but for a country this sparse it never
   * produced anything readable: even at an Oceania-only fit the box is 203
   * map units wide, so the atolls inside it render sub-pixel, and once a
   * multi-region fit rotates the projection's seam through the country the
   * box spans the whole map and the inset is a picture of the entire world.
   * Cape Verde, compact enough that its whole extent is within the focus
   * radius, is unaffected. */
  alwaysInsetFocusByCcn3?: Map<string, [number, number]>;
  /** Countries whose real overseas territory (French Guiana, Réunion, Aruba,
   * Easter Island...) sits far enough from the mainland that the full
   * feature's bounding box centers on open ocean between them instead of
   * anywhere the country actually is — see MAP_SCATTERED_TERRITORY. Mapped
   * to a [longitude, latitude] focus point (in practice the capital), same
   * mechanism as alwaysInsetFocusByCcn3 (geometryNearPoint) but applied only
   * to bounds measurement here, not to fit-target seam adjustment or the
   * always-inset display — these countries render their real mainland shape
   * and don't need a dedicated inset, they just need the ring/anchor/scroll
   * math to measure the mainland instead of the whole scattered feature. */
  boundsFocusByCcn3?: Map<string, [number, number]>;
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
  // Mirrors the latest setHoverAt closure (reassigned every render, below) so
  // the native wheel listener — deliberately scoped to `[projected]` so it
  // isn't torn down and reattached on every render — can still call the
  // current render's version instead of a stale one from whenever the
  // listener was last attached.
  const setHoverAtRef = useRef<(clientX: number, clientY: number) => void>(() => {});

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
    const rotationLon = isFocused ? meanLongitude(finalTarget) : 0;
    if (isFocused) projection.rotate([-rotationLon, 0]);

    // Rotating away from the seam is the whole point of meanLongitude above,
    // but it can only move the seam somewhere — for a selection spanning
    // opposite sides of the globe it lands *on* a country instead of in open
    // ocean. That country then has geometry at both edges of the map, so the
    // box fitExtent sees for it is the full 360° and the fit gives up and
    // renders the whole world however tight the actual selection is: Africa +
    // Oceania puts the seam through Kiribati, and fitting around Kiribati's
    // 360° box scaled the map to 139 where the selection itself only needed
    // 233 — the entire world on screen to show two regions.
    //
    // Only a country we have a focus point for is substituted (fit to that
    // island group instead of its split full extent). A seam-crossing country
    // without one stays in the fit exactly as before, whole-world result and
    // all: dropping it is fine for an outlying archipelago but not for, say,
    // the USA, which the seam runs through whenever every region is selected
    // at once (rotation ~21°E puts it through Alaska) — cutting that from the
    // fit zooms past Alaska and Hawaii entirely, which is worse than a
    // too-wide fit.
    const seamAdjusted: unknown[] = isFocused
      ? finalTarget.map<unknown>((f) => {
          // A point country renders as a marker at one coordinate, so that
          // coordinate — not the polygon nothing will draw — is what the fit
          // has to keep in frame. Same seam problem otherwise: Kiribati is a
          // marker on Manifest and on every summary map, and its unrendered
          // polygon was still dragging those fits out to the whole world.
          const marker = pointCountries?.get(f.id);
          if (marker) return { type: "Feature", geometry: { type: "Point", coordinates: marker } };
          if (!crossesProjectionSeam(f, rotationLon)) return f;
          const focus = alwaysInsetFocusByCcn3?.get(f.id);
          return (focus && geometryNearPoint(f, focus)) || f;
        })
      : finalTarget;
    const fitFeatures = seamAdjusted.length > 0 ? seamAdjusted : finalTarget;

    projection.fitExtent(
      [
        [PADDING, PADDING],
        [WIDTH - PADDING, HEIGHT - PADDING],
      ],
      { type: "FeatureCollection", features: fitFeatures } as any,
    );
    return { projection, path: geoPath(projection) };
  }, [features, focusCcn3s, alwaysInsetFocusByCcn3, pointCountries]);

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
        // A trackpad pinch reports as ctrl+wheel, not a touch pointer gesture
        // — it never fires the pointermove-based updateHover, so without
        // this the magnifier (and the auto-zoom inset, via the `transform`
        // dependency above) would freeze exactly like the touch pinch case
        // this same fix addressed for PointerEvent-based gestures. Goes
        // through the ref (see its declaration) rather than calling
        // setHoverAt directly since this listener is deliberately not
        // re-attached on every render.
        setHoverAtRef.current(e.clientX, e.clientY);
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
        setHoverAtRef.current(e.clientX, e.clientY);
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
    const coloring: Coloring = { filledCcn3s, currentCcn3, wrongCcn3s, reviewTierByCcn3, focusCcn3s };
    const elements = features.map((f, i) => {
      // A point-country override takes full precedence over its real
      // polygon (e.g. Tuvalu, which has no polygon at all in the topology) —
      // skip it entirely here.
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

        // Everything that asks "where is this country on screen" — the
        // auto-zoom inset and its anchor dot, the current-question locator
        // ring, the portrait-mode scroll-into-view — reads these bounds, so a
        // scattered country measures its focused island group rather than its
        // full extent. Measuring the full extent put all four of those in the
        // middle of Africa for Kiribati (see the prop's comment); it's also
        // what the inset was zooming to, hence a "close-up" of the whole
        // world. The rendered path below is still the country's real, complete
        // geometry — only the measurement is focused. boundsFocusByCcn3 covers
        // the same problem for countries whose overseas territory (not a
        // legibility issue, just distance) pulls the box's center out into
        // open ocean — see its own comment. It uses a tighter radius than the
        // always-inset case above: France/Netherlands/Chile's real exclaves
        // are tens of degrees out (comfortably excluded either way), but
        // Tonga's own OTHER real island groups (Ha'apai, Vava'u) are only a
        // couple of degrees from the capital's — the wide radius tuned for
        // "keep a whole close-together archipelago in one inset" would keep
        // all of Tonga too, right back where it started.
        const insetFocus = alwaysInsetFocusByCcn3?.get(f.id);
        const boundsFocus = boundsFocusByCcn3?.get(f.id);
        const measured = insetFocus
          ? geometryNearPoint(f, insetFocus) || f
          : boundsFocus
            ? geometryNearPoint(f, boundsFocus, BOUNDS_FOCUS_RADIUS_DEGREES) || f
            : f;
        const b = path.bounds(measured as any) as [[number, number], [number, number]];
        const box: Bounds = [b[0][0], b[0][1], b[1][0], b[1][1]];
        const existingBox = bounds.get(f.id);
        bounds.set(f.id, existingBox ? mergeBounds(existingBox, box) : box);
      }
      const popClass = justFilledIds.has(f.id) ? " map-pop-in" : "";
      return (
        <path
          key={`${f.id}-${i}`}
          d={d}
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
          className={fillClassForId(f.id, coloring) + popClass}
        />
      );
    });

    const pointElements = pointCountries
      ? Array.from(pointCountries.entries())
          .map(([id, lngLat]) => {
            const point = projection(lngLat);
            if (!point) return null;
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
                className={fillClassForId(id, coloring) + popClass}
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
    alwaysInsetFocusByCcn3,
    boundsFocusByCcn3,
  ]);

  // Where each island of the auto-zoomed country's focused group sits, and how
  // big it draws — for the inset's island markers below. Only computed for a
  // country with a focus point (Kiribati, Cape Verde); everything else gets an
  // empty list and renders nothing extra.
  const insetIslands = useMemo(() => {
    const focus = autoZoomCcn3 ? alwaysInsetFocusByCcn3?.get(autoZoomCcn3) : undefined;
    if (!features || !projected || !focus) return [];
    const f = features.find((candidate) => candidate.id === autoZoomCcn3);
    const group = f && geometryNearPoint(f, focus);
    if (!group) return [];
    return group.geometry.coordinates.map((coordinates) => {
      const b = projected.path.bounds({ type: "Polygon", coordinates } as any) as [
        [number, number],
        [number, number],
      ];
      return {
        x: (b[0][0] + b[1][0]) / 2,
        y: (b[0][1] + b[1][1]) / 2,
        size: Math.max(b[1][0] - b[0][0], b[1][1] - b[0][1]),
      };
    });
  }, [features, projected, autoZoomCcn3, alwaysInsetFocusByCcn3]);

  // A pulsing "locate me" ring at the current question's centroid, on top of
  // its own current-pulse yellow fill — color alone wasn't always enough to
  // pick it out at a glance when a wrong-answer red country happened to sit
  // right next to it (both are warm hues on the dark map background). Reuses
  // built.bounds (already computed for the auto-zoom inset above) rather
  // than measuring the shape again. Radius is clamped so a huge current
  // country doesn't balloon into a ring bigger than the map — this is a
  // locator, not an attempt to trace the actual outline. Works the same
  // whether currentCcn3 arrives alongside reviewTierByCcn3 (One Stop live)
  // or filledCcn3s/wrongCcn3s (the other two play screens) — the review
  // summary map never passes currentCcn3 at all, so this is a no-op there.
  const currentRingBounds = currentCcn3 !== undefined ? built?.bounds.get(currentCcn3) : undefined;
  const currentRingCenterX = currentRingBounds ? (currentRingBounds[0] + currentRingBounds[2]) / 2 : 0;
  const currentRingCenterY = currentRingBounds ? (currentRingBounds[1] + currentRingBounds[3]) / 2 : 0;
  const currentRingSize = currentRingBounds
    ? Math.max(currentRingBounds[2] - currentRingBounds[0], currentRingBounds[3] - currentRingBounds[1])
    : 0;
  // The 10-28 clamp below is sized for a real polygon shape (room to sit
  // just outside its edge). A point-marker country (Kosovo, Tuvalu — see
  // MAP_HARD_TO_RENDER) has no shape, just a POINT_COUNTRY_RADIUS dot, so
  // that same clamp floats a ring roughly 3x the dot's own size with nothing
  // visible for it to hug — it reads as a stray circle rather than a locator.
  // Scale it off the dot's own radius instead.
  const isCurrentPointCountry = currentCcn3 !== undefined && !!pointCountries?.has(currentCcn3);
  const currentRingRadius = isCurrentPointCountry
    ? POINT_COUNTRY_RADIUS + 3
    : Math.min(Math.max(currentRingSize / 2 + 6, 10), 28);

  const autoZoomBounds = autoZoomCcn3 ? built?.bounds.get(autoZoomCcn3) : undefined;
  const autoZoomSize = autoZoomBounds
    ? Math.max(autoZoomBounds[2] - autoZoomBounds[0], autoZoomBounds[3] - autoZoomBounds[1])
    : 0;
  const isAlwaysInset = !!autoZoomCcn3 && !!alwaysInsetFocusByCcn3?.has(autoZoomCcn3);
  // The inset only earns its place while the map is at its default fit —
  // it exists to make a country legible when the player has no other way to
  // get a closer look. The moment they zoom in manually they're doing that
  // job themselves, so a floating blow-up of a country they're already
  // inspecting (or that their own zoom has pushed off-screen) is just
  // clutter bolted over the map. Hide it for any manual zoom and bring it
  // straight back at the default view. Same 1.01 epsilon the Reset-zoom
  // button uses to decide whether there's anything to reset, so the two
  // can't disagree about what "zoomed in" means.
  const isDefaultZoom = transform.scale <= 1.01;
  const showAutoZoom =
    !!autoZoomBounds && isDefaultZoom && (isAlwaysInset || autoZoomSize < SMALL_COUNTRY_THRESHOLD);
  const autoZoomCenterX = autoZoomBounds ? (autoZoomBounds[0] + autoZoomBounds[2]) / 2 : 0;
  const autoZoomCenterY = autoZoomBounds ? (autoZoomBounds[1] + autoZoomBounds[3]) / 2 : 0;
  const autoZoomCenter = [autoZoomCenterX, autoZoomCenterY];
  // A "sparse" country shows its focused island group with a little room to
  // breathe around it (autoZoomBounds is already only that group, not the
  // country's full extent — see alwaysInsetFocusByCcn3); a genuinely
  // small-and-compact one gets a fixed close-up padding.
  const autoZoomRadius = isAlwaysInset ? autoZoomSize / 2 + 10 : Math.max(autoZoomSize / 2 + 6, 10);
  // Zooming can't rescue an island that's smaller than a pixel to begin with:
  // Kiribati's Gilbert atolls are 0.1-1 map units of land spread over a
  // ~19-unit chain, so a bubble framing the chain draws each of them 1-3px —
  // an empty circle, which is what the inset showed even once it was pointed
  // at the right place. Islands that come out under INSET_MIN_ISLAND_PX get a
  // marker at their own position instead, on the same "a dot beats an
  // invisible shape" principle as MAP_HARD_TO_RENDER's point countries, one
  // per island rather than one per country. Both sizes convert from px into
  // map units against the inset's own zoom, so the markers stay a constant
  // size on screen and — the part that matters — an island already big enough
  // to read keeps its real outline: none of Cape Verde's eight, at 4-9px in
  // its own inset, is replaced by anything.
  const insetPxToUnits = (autoZoomRadius * 2) / BLOWUP_SIZE;
  const insetMarkerRadius = INSET_ISLAND_MARKER_PX * insetPxToUnits;
  const insetMinIslandSize = INSET_MIN_ISLAND_PX * insetPxToUnits;

  // Tracks the auto-zoomed country's real on-screen position (via the main
  // map SVG's screen CTM, same technique as updateHover's inverse) so the
  // inset can float directly above it instead of sitting in a fixed corner
  // disconnected from what it's showing. Recomputed on resize, on any scroll
  // (capture-phase, since the map's own portrait-mode horizontal scroll
  // container is a descendant, not the window), and on `transform` itself —
  // getScreenCTM already folds in the pinch/pan/wheel-zoom CSS transform, but
  // only a fresh read after it changes reflects the new position; without
  // `transform` in the deps this stayed frozen at wherever the inset was
  // when a pinch or pan gesture started, the same class of bug the manual
  // magnifier lens had (see setHoverAt calls in the gesture handlers above).
  //
  // useLayoutEffect, not useEffect: during a fast momentum-driven glide
  // (startMomentum's rAF loop calls applyTransform many times per second),
  // a regular useEffect — deliberately deferred by React until after
  // paint — measurably lagged a few frames behind the transform actually
  // on screen, since the passive-effect queue can't always keep pace with
  // that rapid a stream of updates. useLayoutEffect runs synchronously as
  // part of the same commit as the transform change, so the anchor is
  // always read against the CTM matching what's about to be painted, not a
  // few frames behind it. Confirmed via a real repro: sampling mid-glide
  // showed 40-50px of drift with useEffect, 0px with useLayoutEffect.
  useLayoutEffect(() => {
    if (!showAutoZoom) {
      setAutoZoomAnchor(null);
      return;
    }
    const svg = svgRef.current;
    const container = scrollContainerRef.current;
    if (!svg || !container) return;
    function updateAnchor() {
      if (!svg || !container) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = autoZoomCenterX;
      pt.y = autoZoomCenterY;
      const screenPt = pt.matrixTransform(ctm);

      // Once a manual zoom/pan has pushed the country outside the visible
      // map area, an inset "pointing at" it is worse than no inset: the
      // anchor dot is off-screen, so the bubble gets clamped back into a
      // corner and its two leader lines run off the edge toward a spot the
      // player can't see — which reads as a detached panel floating over an
      // unrelated part of the world. Dropping the anchor entirely hides the
      // whole inset until the country is back in view.
      const view = container.getBoundingClientRect();
      const inView =
        screenPt.x >= view.left &&
        screenPt.x <= view.right &&
        screenPt.y >= view.top &&
        screenPt.y <= view.bottom;

      // Bail out of redundant state updates (same position, or still
      // hidden) — this runs on every frame of a pinch and of a momentum
      // glide, and a fresh object each time would re-render for nothing.
      setAutoZoomAnchor((prev) => {
        if (!inView) return prev === null ? prev : null;
        if (prev && Math.abs(prev.x - screenPt.x) < 0.5 && Math.abs(prev.y - screenPt.y) < 0.5) return prev;
        return { x: screenPt.x, y: screenPt.y };
      });
    }
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);
    // The svg's own box can change size/position without the window ever
    // resizing — the play screens animate its height (`transition-[height]`)
    // when the mobile keyboard opens, and any surrounding layout shift moves
    // it too. Neither fires `resize` or `scroll`, and neither touches
    // `transform`, so nothing else here would notice the CTM had changed and
    // the anchor would keep using the old geometry. Observing the elements
    // directly covers every such case, animated frames included.
    const observer = new ResizeObserver(updateAnchor);
    observer.observe(svg);
    observer.observe(container);
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
      observer.disconnect();
    };
  }, [showAutoZoom, autoZoomCenterX, autoZoomCenterY, transform]);

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
  setHoverAtRef.current = setHoverAt;

  function updateHover(e: ReactPointerEvent<SVGSVGElement>) {
    setHoverAt(e.clientX, e.clientY);
  }

  const hoveredLabel = hover?.hoveredId ? labelsByCcn3?.get(hover.hoveredId) : undefined;
  // Whether the lens would actually render right now — magnifierOn is just
  // the button's toggle state; past MAGNIFIER_MAX_SCALE the lens hides
  // itself, so anything cosmetic that only makes sense while it's visible
  // (hiding the cursor, offsetting the hover label) needs this instead.
  const magnifierVisible = magnifierOn && transform.scale <= MAGNIFIER_MAX_SCALE;

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
      // Keeps the magnifier (anchored to `hover`) tracking the pinch instead
      // of freezing wherever it was when the gesture started — see
      // MAGNIFIER_MAX_SCALE above for why it stops rendering past a point.
      setHoverAt(mid.x, mid.y);
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
      // Same reasoning as the pinch branch above — a single-finger drag once
      // already zoomed in is a pan, not a hover, but the magnifier should
      // still follow the finger rather than staying put.
      setHoverAt(e.clientX, e.clientY);

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
          className={`bg-paper dark:bg-paper-dark ${magnifierVisible ? "cursor-none" : ""} ${className ?? ""}`}
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
          {currentRingBounds && (
            <circle
              cx={currentRingCenterX}
              cy={currentRingCenterY}
              r={currentRingRadius}
              fill="none"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className="pin-pulse pointer-events-none stroke-cat-yellow dark:stroke-cat-yellow-dark"
            />
          )}
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
                  {autoZoomCcn3 &&
                    insetIslands.map(({ x, y, size }, i) =>
                      size < insetMinIslandSize ? (
                        <circle
                          key={`island-${i}`}
                          cx={x}
                          cy={y}
                          r={insetMarkerRadius}
                          strokeWidth={0.5}
                          vectorEffect="non-scaling-stroke"
                          className={fillClassForId(autoZoomCcn3, {
                            filledCcn3s,
                            currentCcn3,
                            wrongCcn3s,
                            reviewTierByCcn3,
                            focusCcn3s,
                          })}
                        />
                      ) : null,
                    )}
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
            top: hover!.clientY - (magnifierVisible ? LENS_SIZE / 2 + 28 : 24),
          }}
        >
          {hoveredLabel}
        </div>
      )}

      {magnifierVisible && hover && (
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
