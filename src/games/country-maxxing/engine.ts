import { countries as allCountries, withArticle, type Country } from "../../data/countries";
import { borderLengthBetween } from "../../data/borderLengths";
import { SIZE_COMPARE_INELIGIBLE } from "../../data/mapCoverage";
import { getMissWeight, getStat, pickWeighted, recordAttempt } from "../../core/stats";
import type { TalliedItem } from "../../core/sessionTally";
import { REVIEW_TIER_MAX_TRIES, type ReviewTier } from "../../components/WorldMap";

export type Direction = "country-to-capital" | "capital-to-country";
export type DirectionSetting = Direction | "mixed";
export type SessionType = "learn" | "quiz";
export type NameAllSubject = "countries" | "capitals";

export const NAMESPACE = "country-maxxing";
const MISTAKE_MIN_ATTEMPTS = 2;
const MISTAKE_MAX_ACCURACY = 0.7;

// A missed item in Learn mode comes back after a short, bounded gap instead
// of at the very end of a potentially-huge queue — testing it again while
// the miss is still fresh actually reinforces it; with 54 African countries
// loaded, a miss requeued to the very back could resurface 50 questions
// later, well past the point where the first exposure could help. Shared
// across all four play screens' requeue-on-miss logic.
const REQUEUE_GAP = 6;

export function requeueAfterMiss<T>(rest: T[], item: T): T[] {
  const at = Math.min(REQUEUE_GAP, rest.length);
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

// A country's outcome + try count this session, for WorldMap's difficulty-
// tint coloring (see ReviewTier) — one implementation shared by every
// mode's post-session summary (ReviewMap.tsx) and, live, by One Stop's own
// map while playing (PromptAndAnswerPlay.tsx calls this every render off
// sessionTally.getItems(), which is safe despite sessionTally itself being
// a plain ref — every record() call is always followed by a sibling
// setState in the same event, so a re-render (and thus a fresh call here)
// is already guaranteed without this needing to be reactive on its own).
export function tierByCcn3(pool: Country[], sessionTally: TalliedItem[]): Map<string, ReviewTier> {
  const ccn3ByCca3 = new Map(pool.map((c) => [c.cca3, c.ccn3] as const));
  const tiers = new Map<string, ReviewTier>();
  for (const item of sessionTally) {
    const ccn3 = ccn3ByCca3.get(item.cca3);
    if (!ccn3) continue;
    // The last attempt is the eventual outcome — Learn mode requeues a miss
    // until it's answered right, so by the time a country stops being
    // asked, its final attempt reflects where it landed (Quiz mode never
    // requeues, so its one attempt is already final).
    const finalCorrect = item.attempts[item.attempts.length - 1] === true;
    // A give-up forces the scale's far end regardless of the raw attempt
    // count — giving up is a stronger "this one was hard" signal than a
    // single wrong guess.
    const tries = item.gaveUp ? REVIEW_TIER_MAX_TRIES : item.attempts.length;
    tiers.set(ccn3, { outcome: finalCorrect ? "correct" : "wrong", tries });
  }
  return tiers;
}

export interface Question {
  country: Country;
  direction: Direction;
}

function statTag(country: Country, tag: string): string {
  return `${country.cca3}:${tag}`;
}

export function questionKey(question: Question): string {
  return statTag(question.country, question.direction);
}

// Name All is free recall (no per-item prompt), a different skill from Prompt
// & Answer's cued recall — tracked under its own tag so "focus on weak
// spots" doesn't conflate the two.
function nameAllTag(subject: NameAllSubject): string {
  return `name-all-${subject}`;
}

function pickDirection(setting: DirectionSetting): Direction {
  if (setting !== "mixed") return setting;
  return Math.random() < 0.5 ? "country-to-capital" : "capital-to-country";
}

// Recency-weighted, not lifetime — see emaMiss in stats.ts. A country that
// was missed a lot months ago but has been answered correctly the last few
// times drops out of "weak" quickly, rather than needing to out-earn a
// whole history of old misses one correct answer at a time.
function isWeak(country: Country, tag: string): boolean {
  const stat = getStat(NAMESPACE, statTag(country, tag));
  if (!stat || stat.attempts < MISTAKE_MIN_ATTEMPTS) return false;
  return stat.emaMiss > 1 - MISTAKE_MAX_ACCURACY;
}

export function isWeakItem(country: Country, direction: Direction): boolean {
  return isWeak(country, direction);
}

export function poolForRegions(selectedRegions: Set<string>): Country[] {
  return allCountries.filter((c) => selectedRegions.has(c.region));
}

export function weakPoolFor(pool: Country[], directionSetting: DirectionSetting): Country[] {
  if (directionSetting !== "mixed") {
    return pool.filter((c) => isWeakItem(c, directionSetting));
  }
  return pool.filter((c) => isWeakItem(c, "country-to-capital") || isWeakItem(c, "capital-to-country"));
}

export function weakPoolForNameAll(pool: Country[], subject: NameAllSubject): Country[] {
  return pool.filter((c) => isWeak(c, nameAllTag(subject)));
}

export function recordNameAllAttempt(country: Country, subject: NameAllSubject, correct: boolean): void {
  recordAttemptFor(country, nameAllTag(subject), correct);
}

// Weighted shuffle: every item appears exactly once, but historically-missed
// items tend to surface earlier rather than being purely uniform-random.
export function buildQueue(pool: Country[], directionSetting: DirectionSetting): Question[] {
  const remaining: Question[] = pool.map((country) => ({
    country,
    direction: pickDirection(directionSetting),
  }));
  const queue: Question[] = [];
  while (remaining.length > 0) {
    const picked = pickWeighted(remaining, (q) => getMissWeight(NAMESPACE, questionKey(q)));
    queue.push(picked);
    remaining.splice(remaining.indexOf(picked), 1);
  }
  return queue;
}

export function promptFor(question: Question): string {
  return question.direction === "country-to-capital"
    ? `What is the capital of ${withArticle(question.country)}?`
    : `${question.country.capital} is the capital of which country?`;
}

export function expectedAnswer(question: Question): string {
  return question.direction === "country-to-capital" ? question.country.capital : withArticle(question.country);
}

// A capital literally named "<Place> City" or "City of <Place>" (Kuwait
// City, Mexico City, Guatemala City, Panama City, Vatican City, City of San
// Marino) reads naturally as just "<Place>" too — accept both forms rather
// than only the official full one.
export function capitalMatchCandidates(country: Country): string[] {
  return country.capitals.flatMap((capital) => {
    const cityOf = /^City of (.+)$/i.exec(capital);
    if (cityOf) return [capital, cityOf[1]!];
    const trailingCity = /^(.+) City$/i.exec(capital);
    if (trailingCity) return [capital, trailingCity[1]!];
    return [capital];
  });
}

// A handful of countries (e.g. South Africa) officially list more than one
// capital — any of them counts as correct, even though prompts and lists
// only ever show the primary one.
export function matchCandidates(question: Question): string[] {
  return question.direction === "country-to-capital"
    ? capitalMatchCandidates(question.country)
    : [question.country.name, ...question.country.altNames];
}

export function nameAllCandidates(country: Country, subject: NameAllSubject): string[] {
  return subject === "countries" ? [country.name, ...country.altNames] : capitalMatchCandidates(country);
}

export function nameAllLabel(country: Country, subject: NameAllSubject): string {
  return subject === "countries" ? country.name : country.capital;
}

// Display-only variant for the found list: pairs a capital with its country
// so "Wellington" also reads as "Wellington (New Zealand)". Sort by
// nameAllLabel, not this — appending the country name would scramble order.
export function nameAllListLabel(country: Country, subject: NameAllSubject): string {
  return subject === "capitals" ? `${country.capital} (${country.name})` : country.name;
}

function recordAttemptFor(country: Country, tag: string, correct: boolean): void {
  recordAttempt(NAMESPACE, statTag(country, tag), correct);
}

// Map Identify: recognizing a highlighted shape, and (optionally) recalling
// its capital, are different skills — tracked under separate tags so
// "focus on weak spots" can tell "can't recognize the shape" apart from
// "recognizes it but doesn't know the capital."
const MAP_IDENTIFY_TAG = "map-identify";
const MAP_IDENTIFY_CAPITAL_TAG = "map-identify-capital";

export function isWeakMapIdentify(country: Country, askCapital: boolean): boolean {
  if (isWeak(country, MAP_IDENTIFY_TAG)) return true;
  return askCapital && isWeak(country, MAP_IDENTIFY_CAPITAL_TAG);
}

export function weakPoolForMapIdentify(pool: Country[], askCapital: boolean): Country[] {
  return pool.filter((c) => isWeakMapIdentify(c, askCapital));
}

// Weighted shuffle over countries directly (no per-item "direction" the way
// Prompt & Answer has) — every item appears exactly once per pass.
export function buildMapIdentifyQueue(pool: Country[]): Country[] {
  const remaining = [...pool];
  const queue: Country[] = [];
  while (remaining.length > 0) {
    const picked = pickWeighted(remaining, (c) => getMissWeight(NAMESPACE, statTag(c, MAP_IDENTIFY_TAG)));
    queue.push(picked);
    remaining.splice(remaining.indexOf(picked), 1);
  }
  return queue;
}

export function recordMapIdentifyAttempt(
  country: Country,
  countryCorrect: boolean,
  askCapital: boolean,
  capitalCorrect: boolean,
): void {
  recordAttemptFor(country, MAP_IDENTIFY_TAG, countryCorrect);
  if (askCapital) recordAttemptFor(country, MAP_IDENTIFY_CAPITAL_TAG, capitalCorrect);
}

// Border mode: three distinct question shapes sharing one queue/stats
// namespace (each tagged separately, same reasoning as Name All vs Prompt &
// Answer — different skills shouldn't conflate "weak spot" tracking).
// - "name-neighbors": free recall, list every country bordering the subject.
// - "reverse-lookup": given the subject's full neighbor list as a clue, name
//   the subject itself.
// - "longest-shortest": name which neighbor shares the subject's longest (or
//   shortest) land border — needs borderLengths.ts and 2+ neighbors to be a
//   real comparison, not just "name the only neighbor."
export type BorderQuestionType = "name-neighbors" | "reverse-lookup" | "longest-shortest";
export type BorderQuestionTypeSetting = BorderQuestionType | "mixed";

export interface BorderQuestion {
  type: BorderQuestionType;
  country: Country;
  neighbors: Country[];
  /** Only set for "longest-shortest". */
  extreme?: "longest" | "shortest";
}

function neighborsOf(country: Country): Country[] {
  return country.borders
    .map((cca3) => allCountries.find((c) => c.cca3 === cca3))
    .filter((c): c is Country => !!c);
}

function borderTag(type: BorderQuestionType): string {
  return `borders-${type}`;
}

export function borderQuestionKey(question: BorderQuestion): string {
  return statTag(question.country, borderTag(question.type));
}

// "reverse-lookup" only has one correct answer if the subject is the *only*
// country with that exact set of neighbors — several real countries share an
// identical neighbor set (Papua New Guinea and Timor-Leste both border only
// Indonesia; San Marino and Vatican City both border only Italy; Bhutan and
// Nepal both border exactly {China, India}; UAE and Yemen both border
// exactly {Oman, Saudi Arabia}), which makes "which country borders all of:
// X" genuinely ambiguous — a correct-but-unintended guess would be marked
// wrong. Checked against the full dataset, not the current region pool,
// since narrowing the pool doesn't change whether two countries actually
// share a neighbor set.
const neighborSignatureCounts = new Map<string, number>();
let signatureCountsBuilt = false;

function neighborSignature(neighbors: Country[]): string {
  return neighbors
    .map((n) => n.cca3)
    .sort()
    .join(",");
}

function ensureSignatureCounts(): void {
  if (signatureCountsBuilt) return;
  signatureCountsBuilt = true;
  for (const c of allCountries) {
    const sig = neighborSignature(neighborsOf(c));
    if (!sig) continue;
    neighborSignatureCounts.set(sig, (neighborSignatureCounts.get(sig) ?? 0) + 1);
  }
}

function uniquelyIdentifiedByNeighbors(neighbors: Country[]): boolean {
  ensureSignatureCounts();
  const sig = neighborSignature(neighbors);
  return sig !== "" && neighborSignatureCounts.get(sig) === 1;
}

function eligibleTypesFor(neighbors: Country[]): BorderQuestionType[] {
  const types: BorderQuestionType[] = [];
  if (neighbors.length >= 1) {
    types.push("name-neighbors");
    if (uniquelyIdentifiedByNeighbors(neighbors)) types.push("reverse-lookup");
  }
  if (neighbors.length >= 2) types.push("longest-shortest");
  return types;
}

// Filters down to only the countries that can actually get a question under
// the given type setting (islands with zero land borders never can; a
// country with exactly one neighbor can't support "longest-shortest").
// Callers should pass this — not the raw region pool — into anything that
// counts "how many questions this session," including buildBorderQueue's
// caller: the setup screen's own count, and the give-up summary's
// mastered/missed math, both assume pool.length questions were askable.
// Without this filter, countries that were never eligible in the first
// place get silently counted as "mastered" on give-up instead of excluded.
export function borderEligiblePool(pool: Country[], typeSetting: BorderQuestionTypeSetting): Country[] {
  return pool.filter((c) => {
    const eligible = eligibleTypesFor(neighborsOf(c));
    return typeSetting === "mixed" ? eligible.length > 0 : eligible.includes(typeSetting);
  });
}

// Weighted shuffle, same shape as buildQueue/buildMapIdentifyQueue — every
// pool country with at least one land border gets exactly one question.
// Islands (no borders at all) can't be asked about here and are skipped.
export function buildBorderQueue(pool: Country[], typeSetting: BorderQuestionTypeSetting): BorderQuestion[] {
  const remaining: BorderQuestion[] = [];
  for (const country of pool) {
    const neighbors = neighborsOf(country);
    const eligible = eligibleTypesFor(neighbors);
    if (eligible.length === 0) continue;
    const type =
      typeSetting === "mixed"
        ? eligible[Math.floor(Math.random() * eligible.length)]!
        : eligible.includes(typeSetting)
          ? typeSetting
          : null;
    if (!type) continue;
    const extreme: BorderQuestion["extreme"] =
      type === "longest-shortest" ? (Math.random() < 0.5 ? "longest" : "shortest") : undefined;
    remaining.push({ type, country, neighbors, extreme });
  }
  const queue: BorderQuestion[] = [];
  while (remaining.length > 0) {
    const picked = pickWeighted(remaining, (q) => getMissWeight(NAMESPACE, borderQuestionKey(q)));
    queue.push(picked);
    remaining.splice(remaining.indexOf(picked), 1);
  }
  return queue;
}

export function borderPromptFor(question: BorderQuestion): string {
  if (question.type === "name-neighbors") {
    return `Which countries border ${withArticle(question.country)}?`;
  }
  if (question.type === "reverse-lookup") {
    if (question.neighbors.length === 1) {
      return `Which country's only land border is with ${withArticle(question.neighbors[0]!)}?`;
    }
    const names = question.neighbors.map((n) => withArticle(n)).join(", ");
    return `Which country borders all of: ${names}?`;
  }
  return `Which of ${withArticle(question.country)}'s neighbors shares its ${question.extreme} land border with it?`;
}

/** The single neighbor with the longest/shortest shared border — undefined
 * only if border-length data is somehow missing (shouldn't happen given
 * eligibleTypesFor already requires 2+ neighbors for this type). */
export function longestShortestNeighbor(question: BorderQuestion): Country | undefined {
  const withLengths = question.neighbors
    .map((n) => ({ country: n, km: borderLengthBetween(question.country.cca3, n.cca3) }))
    .filter((x): x is { country: Country; km: number } => x.km != null);
  if (withLengths.length === 0) return undefined;
  const sorted = [...withLengths].sort((a, b) => (question.extreme === "longest" ? b.km - a.km : a.km - b.km));
  return sorted[0]!.country;
}

export function borderMatchCandidates(question: BorderQuestion): string[] {
  if (question.type === "reverse-lookup") return [question.country.name, ...question.country.altNames];
  const answer = longestShortestNeighbor(question);
  return answer ? [answer.name, ...answer.altNames] : [];
}

export function borderExpectedAnswer(question: BorderQuestion): string {
  if (question.type === "reverse-lookup") return withArticle(question.country);
  const answer = longestShortestNeighbor(question);
  return answer ? withArticle(answer) : "";
}

export function recordBorderAttempt(question: BorderQuestion, correct: boolean): void {
  recordAttemptFor(question.country, borderTag(question.type), correct);
}

export function weakPoolForBorders(pool: Country[], typeSetting: BorderQuestionTypeSetting): Country[] {
  return pool.filter((c) => {
    const neighbors = neighborsOf(c);
    const eligible = eligibleTypesFor(neighbors);
    const types = typeSetting === "mixed" ? eligible : eligible.includes(typeSetting) ? [typeSetting] : [];
    return types.some((t) => isWeak(c, borderTag(t)));
  });
}

// Size Compare ("It's Relative"): given a candidate country, pick which of
// three silhouette scales is its true size relative to a randomly-paired
// reference country. Unlike every other mode, correctness isn't about
// recalling a fact — it's picking the right *rendered scale* — so there's
// no prompt text to match, just a candidate/reference pairing and three
// pre-computed scale options (see CountrySilhouette.tsx for how a scale
// value becomes an actual on-screen size). Stats are keyed per-candidate,
// same as every other mode — a per-pair key would need plumbing nothing
// else in this file expects (weakPool*/focusOnWeakSpots all filter a
// Country[] by a per-country tag).
const SIZE_COMPARE_TAG = "size-compare";

// Keeps every option (true value and both decoys) within [1/MAX_DISPLAY_
// RATIO, MAX_DISPLAY_RATIO] of the reference's own baseline — Russia vs.
// Vatican City's real ratio (sqrt of ~38 million) would render one
// silhouette thousands of times the size of the other, and even a "legal"
// pairing near the old, looser cap (Luxembourg vs. Belarus, ~0.11x) turned
// out to render as an all-but-invisible speck at SizeComparePlay's base
// silhouette size — confirmed by actually playing it. 5 keeps the smallest
// possible option comfortably above that floor while still allowing a real,
// interesting size difference to show.
const MAX_DISPLAY_RATIO = 5;
const REFERENCE_PICK_ATTEMPTS = 20;

export interface SizeCompareQuestion {
  candidate: Country;
  reference: Country;
  trueScale: number; // sqrt(candidate.area / reference.area)
}

// Tuvalu has no polygon in world-atlas at all; Kiribati's 19 atolls render
// as sub-pixel specks even fit to their own isolated frame with nothing else
// competing for space (measured directly — every one under 2.1px in both
// dimensions at CountrySilhouette's BASE_PX). Cape Verde, which MAP_HARD_TO_
// RENDER also excludes, was measured the same way and renders fine in
// isolation (8 islands at 8-32px) — that set was curated for whole-map
// legibility, not standalone silhouette legibility, so it isn't reused
// as-is here. See SIZE_COMPARE_INELIGIBLE's own comment in mapCoverage.ts.
export function sizeCompareEligiblePool(pool: Country[]): Country[] {
  return pool.filter((c) => !SIZE_COMPARE_INELIGIBLE.has(c.cca3));
}

export function weakPoolForSizeCompare(pool: Country[]): Country[] {
  return pool.filter((c) => isWeak(c, SIZE_COMPARE_TAG));
}

function trueScaleFor(candidate: Country, reference: Country): number {
  return Math.sqrt(candidate.area / reference.area);
}

// Reference is picked fresh per round, not queued/weighted like the
// candidate — its only job is being a legible comparison point. Rerolls a
// few times for a pairing inside MAX_DISPLAY_RATIO; a pool too narrow to
// ever satisfy that (e.g. a region filtered down to near-identical-sized
// countries only) falls back to whatever the last attempt found rather than
// looping forever — a slightly-too-extreme pairing beats no question at all.
function pickReferenceFor(candidate: Country, pool: Country[]): Country {
  const others = pool.filter((c) => c.cca3 !== candidate.cca3);
  let fallback = others[Math.floor(Math.random() * others.length)]!;
  for (let i = 0; i < REFERENCE_PICK_ATTEMPTS; i++) {
    fallback = others[Math.floor(Math.random() * others.length)]!;
    const scale = trueScaleFor(candidate, fallback);
    if (Math.max(scale, 1 / scale) <= MAX_DISPLAY_RATIO) return fallback;
  }
  return fallback;
}

// Weighted shuffle over candidates, same shape as buildMapIdentifyQueue.
export function buildSizeCompareQueue(pool: Country[]): SizeCompareQuestion[] {
  const remaining = [...pool];
  const queue: SizeCompareQuestion[] = [];
  while (remaining.length > 0) {
    const candidate = pickWeighted(remaining, (c) => getMissWeight(NAMESPACE, statTag(c, SIZE_COMPARE_TAG)));
    remaining.splice(remaining.indexOf(candidate), 1);
    const reference = pickReferenceFor(candidate, pool);
    queue.push({ candidate, reference, trueScale: trueScaleFor(candidate, reference) });
  }
  return queue;
}

export interface ScaleOption {
  value: number;
  correct: boolean;
}

// Two decoys, each the true scale multiplied by a random 1.5-2.5x factor
// (randomly inverted, so a decoy can be "too big" or "too small"), then
// clamped into the same [1/MAX_DISPLAY_RATIO, MAX_DISPLAY_RATIO] envelope
// the true value itself is kept in — without this, a decoy could still
// shrink well past that floor even when the true value didn't (e.g. a
// true value already near the small end, divided by up to 2.5x again).
// Rerolled if either lands within 20% of the true value or of the other
// decoy (checked post-clamp, since clamping can itself collapse two values
// together) — keeps all three visually distinguishable without snapping to
// fixed buckets (1x/3x/10x), so every question's options are shaped around
// the actual pair rather than a preset scale.
const DECOY_FACTOR_MIN = 1.5;
const DECOY_FACTOR_MAX = 2.5;
const DECOY_MIN_SEPARATION = 0.2;
const DECOY_PICK_ATTEMPTS = 20;
const DISPLAY_MIN = 1 / MAX_DISPLAY_RATIO;
const DISPLAY_MAX = MAX_DISPLAY_RATIO;

function pickDecoy(trueScale: number, other: number | null): number {
  let fallback = Math.min(trueScale * DECOY_FACTOR_MAX, DISPLAY_MAX);
  for (let i = 0; i < DECOY_PICK_ATTEMPTS; i++) {
    const factor = DECOY_FACTOR_MIN + Math.random() * (DECOY_FACTOR_MAX - DECOY_FACTOR_MIN);
    const raw = Math.random() < 0.5 ? trueScale * factor : trueScale / factor;
    const value = Math.min(Math.max(raw, DISPLAY_MIN), DISPLAY_MAX);
    fallback = value;
    const farFromTrue = Math.abs(value - trueScale) / trueScale > DECOY_MIN_SEPARATION;
    const farFromOther = other === null || Math.abs(value - other) / other > DECOY_MIN_SEPARATION;
    if (farFromTrue && farFromOther) return value;
  }
  return fallback;
}

export function generateScaleOptions(trueScale: number): ScaleOption[] {
  const decoyA = pickDecoy(trueScale, null);
  const decoyB = pickDecoy(trueScale, decoyA);
  const options: ScaleOption[] = [
    { value: trueScale, correct: true },
    { value: decoyA, correct: false },
    { value: decoyB, correct: false },
  ];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return options;
}

export function recordSizeCompareAttempt(candidate: Country, correct: boolean): void {
  recordAttemptFor(candidate, SIZE_COMPARE_TAG, correct);
}
