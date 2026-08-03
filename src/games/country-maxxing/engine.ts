import { countries as allCountries, type Country } from "../../data/countries";
import { borderLengthBetween } from "../../data/borderLengths";
import { getMissWeight, getStat, pickWeighted, recordAttempt } from "../../core/stats";

export type Direction = "country-to-capital" | "capital-to-country";
export type DirectionSetting = Direction | "mixed";
export type SessionType = "learn" | "quiz";
export type NameAllSubject = "countries" | "capitals";

export const NAMESPACE = "country-maxxing";
const MISTAKE_MIN_ATTEMPTS = 2;
const MISTAKE_MAX_ACCURACY = 0.7;
// A repeat-miss "roast" only shows once a specific item has actually proven
// itself to be a recurring blind spot, not on a first or second slip.
export const ROAST_MISS_THRESHOLD = 3;

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
// & Answer's cued recall — tracked under its own tag so "focus on mistakes"
// doesn't conflate the two.
function nameAllTag(subject: NameAllSubject): string {
  return `name-all-${subject}`;
}

function pickDirection(setting: DirectionSetting): Direction {
  if (setting !== "mixed") return setting;
  return Math.random() < 0.5 ? "country-to-capital" : "capital-to-country";
}

function isWeak(country: Country, tag: string): boolean {
  const stat = getStat(NAMESPACE, statTag(country, tag));
  if (!stat || stat.attempts < MISTAKE_MIN_ATTEMPTS) return false;
  const accuracy = (stat.attempts - stat.misses) / stat.attempts;
  return accuracy < MISTAKE_MAX_ACCURACY;
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
    ? `What is the capital of ${question.country.name}?`
    : `${question.country.capital} is the capital of which country?`;
}

export function expectedAnswer(question: Question): string {
  return question.direction === "country-to-capital" ? question.country.capital : question.country.name;
}

export function questionMissCount(question: Question): number {
  return getStat(NAMESPACE, questionKey(question))?.misses ?? 0;
}

// A handful of countries (e.g. South Africa) officially list more than one
// capital — any of them counts as correct, even though prompts and lists
// only ever show the primary one.
export function matchCandidates(question: Question): string[] {
  return question.direction === "country-to-capital"
    ? question.country.capitals
    : [question.country.name, ...question.country.altNames];
}

export function nameAllCandidates(country: Country, subject: NameAllSubject): string[] {
  return subject === "countries" ? [country.name, ...country.altNames] : country.capitals;
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
// "focus on mistakes" can tell "can't recognize the shape" apart from
// "recognizes it but doesn't know the capital."
const MAP_IDENTIFY_TAG = "map-identify";
const MAP_IDENTIFY_CAPITAL_TAG = "map-identify-capital";

export function isWeakMapIdentify(country: Country, askCapital: boolean): boolean {
  if (isWeak(country, MAP_IDENTIFY_TAG)) return true;
  return askCapital && isWeak(country, MAP_IDENTIFY_CAPITAL_TAG);
}

export function mapIdentifyMissCount(country: Country): number {
  return getStat(NAMESPACE, statTag(country, MAP_IDENTIFY_TAG))?.misses ?? 0;
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
    return `Which countries border ${question.country.name}?`;
  }
  if (question.type === "reverse-lookup") {
    if (question.neighbors.length === 1) {
      return `Which country's only land border is with ${question.neighbors[0]!.name}?`;
    }
    const names = question.neighbors.map((n) => n.name).join(", ");
    return `Which country borders all of: ${names}?`;
  }
  return `Which of ${question.country.name}'s neighbors shares its ${question.extreme} land border with it?`;
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
  if (question.type === "reverse-lookup") return question.country.name;
  return longestShortestNeighbor(question)?.name ?? "";
}

export function borderQuestionMissCount(question: BorderQuestion): number {
  return getStat(NAMESPACE, borderQuestionKey(question))?.misses ?? 0;
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
