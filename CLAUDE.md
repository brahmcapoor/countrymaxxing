# CountryMaxxing

A geography trivia game (countries, capitals, and the map between them),
built on a shelf architecture designed to hold more games later — currently
collapsed to just this one since none exist yet. See "Adding a game" below.

## Stack

- Vite 8 (rolldown) + React 19 + TypeScript 6 + Tailwind CSS v4 (CSS-first
  `@theme`, no `tailwind.config.js`) + vite-plugin-pwa
- **oxlint**, not ESLint — `npx oxlint`
- Node **22.12.0** pinned via `.nvmrc`. Rolldown-vite's native binding fails
  to resolve on Node versions outside `^20.19.0 || >=22.12.0`; if `npm run
  dev` fails with "Cannot find native binding," check `node -v` first.
- No backend. All persistence is `localStorage` (`countrymaxxing:stats:v1`).

## Commands

```
npm run dev              # dev server (localhost:5173)
npx tsc -b --noEmit       # typecheck
npx oxlint                # lint
npm run build             # tsc -b && vite build
```

Run typecheck + lint after every change — both are fast and this codebase
keeps them clean as a standing rule, not just at PR time.

## Architecture

```
src/
  core/          shared infrastructure, game-agnostic
  data/          shared datasets, game-agnostic
  components/    shared UI, game-agnostic
  games/<id>/    one folder per game
  App.tsx        shelf (game picker) + active-game shell
  index.css      @theme tokens, keyframes
```

**`src/core/`**
- `gameRegistry.ts` — `games: Game[]`, the shelf's source of truth
- `palette.ts` — the validated 8-hue categorical color system (see below)
- `stats.ts` — generic per-item mistake tracking (`recordAttempt`,
  `getStat`, `getMissWeight`, `pickWeighted`), namespaced by game
- `fuzzyMatch.ts` — typo-tolerant answer checking (`isCloseMatch`) and a
  strict variant (`isExactMatch`) for live auto-submit — see gotcha below
- `sound.ts` — Web Audio–synthesized SFX, no audio assets
- `combo.ts`, `useCountdown.ts` — small reusable game-mechanic helpers

**`src/data/`** — `countries.ts` (197-country dataset), `capitalCoordinates.ts`,
`mapCoverage.ts` (countries the map can't render well), `roasts.ts`,
`loadingMessages.ts`, `funFacts.ts`, `borderLengths.ts` (bilateral land-border
lengths, keyed by cca3 pair — see "Border mode" below)

**`src/components/`** — `WorldMap.tsx` (the big reusable d3-geo map — see
below), `SoundToggle.tsx`, `Confetti.tsx`, `ListingCard.tsx` (shelf card),
`CompassMark.tsx` (brand mark, also used as page decoration).
`FunFactCard.tsx` exists but isn't currently wired into any screen —
leftover from an earlier home-screen iteration; fine to reuse or remove.

**`src/games/country-maxxing/`**
- `CountryMaxxing.tsx` — setup screen + phase router (setup/play/summary) +
  all settings state
- `engine.ts` — game logic: question building, weighted spaced-repetition
  selection, answer matching, stats recording
- `PromptAndAnswerPlay.tsx` / `NameAllPlay.tsx` / `MapIdentifyPlay.tsx` /
  `BorderPlay.tsx` — the four modes. **Internal ids ≠ display names**:
  `prompt-answer` shows as "One Stop," `name-all` as "Manifest," `map-identify`
  as "Terra Incognita," `borders` as "Frontiers." Rename the `label` in
  `FORMAT_OPTIONS`, not the `Format` type.

### Adding a game

Add an entry to `games` in `gameRegistry.ts` with a `component`. The shelf
card's accent color comes from `hueForIndex(index)` — position in the array,
fixed order, never cycled. A game's own internal accent (its own `ACCENT`
constant) is a separate, independent choice — CountryMaxxing uses `"red"`
internally while sitting in the shelf's blue (`hueForIndex(0)`) slot. That's
intentional, not a bug: the shelf border is a neutral per-slot index color,
the in-game accent is that game's own personality.

## The categorical palette

`palette.ts` defines 8 hues (`blue, orange, aqua, yellow, magenta, green,
violet, red`), validated for colorblind-safe distinguishability as a *set*.
Tailwind class strings (`accentSolidClass` etc.) are written out literally
per-hue — Tailwind's scanner needs literal strings, not template-constructed
ones, or it won't generate the CSS.

CountryMaxxing's poster redesign pushed `cat-red`/`cat-yellow`/`cat-aqua`
more saturated than the other 5 hues, since only one game exists to need
the full set distinguished right now. If a second game starts actually
using multiple hues side by side for identity, re-run a contrast/CVD check
before trusting the set as "validated" again.

## WorldMap.tsx

Renders `world-atlas`'s 50m topology via `d3-geo`, projected with
`geoNaturalEarth1`. Notable things baked in from real bugs hit building it:

- Antimeridian-crossing countries (Fiji) and long-span outliers (Russia)
  are handled via circular-mean-longitude rotation + an outlier exclusion
  from the fit target — see `meanLongitude`/`OUTLIER_SPAN_DEGREES`.
- Hit-testing is a hidden `<canvas>` + `Path2D`, not DOM event targets.
- `mapCoverage.ts`'s `MAP_HARD_TO_RENDER`/`MAP_ALWAYS_INSET` are a
  **known-cases list, not an automatic detector** — countries with no
  polygon in the topology (Tuvalu, Kosovo) or too sparse/small to read at
  normal zoom (Kiribati, Cape Verde) get a marker or a dedicated inset.
  Add to this list by hand if another one turns up.
- Decorative `position: fixed` overlays need `isolate` on an ancestor plus
  a negative `z-index` to paint behind static content — a bare negative
  z-index falls behind the *whole page's* background, not just its own
  container, without a stacking-context boundary to contain it.
- The magnifier lens and auto-zoom inset are independent features; both
  read from the same memoized `built.elements`, so adding a third "zoomed"
  view should reuse that memo rather than recomputing paths.
- `currentCcn3` (optional prop) marks the one country the active question is
  about — rendered in a distinct yellow (`fill-cat-yellow`) instead of the
  regular "done/found" fill (`fill-cat-blue/65` light, `fill-cat-red-dark/65`
  dark — faded relative to the current-question yellow on purpose). Compare
  with `currentCcn3 !== undefined && f.id === currentCcn3`, never bare
  `f.id === currentCcn3` — several topology features (disputed territories,
  ones sharing a parent's id) have `id === undefined`, and when `currentCcn3`
  is legitimately `undefined` (the normal state whenever nothing should be
  highlighted yet), a bare `===` matches *all* of them at once. Real bug hit
  building this — multiple unrelated countries flashed yellow simultaneously.
- Only `PromptAndAnswerPlay` (One Stop) passes `currentCcn3`, since it's the
  only mode that persists a running "done" set alongside a distinct "current"
  one. Map Identify only ever highlights the current country (no persisted
  history), so it deliberately does *not* pass `currentCcn3` — doing so would
  recolor its single highlight yellow instead of its established blue/red.

## Answer matching

Two matchers in `fuzzyMatch.ts`, used for **different purposes**:
- `isCloseMatch` — typo-tolerant (per-word edit-distance budget, capped
  tighter for short words). Used for explicit submission (Submit/Enter).
- `isExactMatch` — exact after normalization only. Used for auto-submit
  while typing. Using `isCloseMatch` there was a real bug: fuzzy tolerance
  let an incomplete answer ("New Delh") get credited before the user
  finished typing.

Both share `normalize()`, which lowercases, strips diacritics/punctuation,
and expands `st` → `saint` (St Lucia, St Vincent, St Kitts).

Every play screen's `handleSubmit` guards on trimmed-empty input before
calling its submit function — pressing Enter/clicking Submit on a blank
field must no-op, not register as a wrong answer. Easy to miss when adding
a new mode since the bug is silent (just an inflated miss count).

**"Real answer, wrong context" gets its own message, not the generic
"unknown" one.** A guess that's correctly spelled but just doesn't apply
here reads very differently from an actual typo, and conflating them is
misleading — "try another spelling?" implies the user is close when they're
not. Manifest checks a non-matching guess against the *full* `countries`
list (not just the region-filtered pool) to catch "real country, wrong
region" (`NameAllPlay.tsx`); Border mode's name-neighbors type does the same
against `borderMatchCandidates`-adjacent full-country matching to catch
"real country, not actually a neighbor" (`BorderPlay.tsx`'s `submitNeighbor`).
Both fall through to the generic unknown/typo hint only once the "is this a
real thing that just doesn't fit here" check comes up empty.

`countries.ts`'s `EXTRA_CAPITALS` map widens `capitals` (the accepted-answer
list) beyond what the `world-countries` package ships, for countries with a
second real, current, officially-recognized capital-like seat (constitutional
vs. seat-of-government) that the package only lists one of — e.g. Sri Lanka
(Colombo vs. Sri Jayawardenepura Kotte), Bolivia (Sucre vs. La Paz). The
listed one always stays primary/displayed (`capital`, `capitals[0]`); the
extra entry only widens what's accepted. Don't add a country here just
because its old/former capital is commonly guessed (Myanmar/Yangon,
Turkey/Istanbul) — that's a different, not-yet-made call about accepting a
technically wrong answer, distinct from genuine dual-capital cases.

## Play-screen answer panel pattern

**Standing rule, all three modes: the answer input's on-screen position must
never move.** Nothing — a hint, a correction, a roast, a "next" affordance —
is allowed to appear or disappear in a way that shifts it, even by a pixel.
This has been raised as a recurring bug (Manifest's "Already got X" hint was
the last offender, appearing *below* the input); treat any new element near
the input with this rule by default, not as an afterthought to fix once
noticed.

Why it's easy to get wrong: every play screen's bottom panel sits in a
`position: absolute; bottom-4` wrapper with no `top` set — it's bottom-
anchored and shrink-wraps to content, so any element that changes height
moves everything *after* it (the net height change shifts the group's top
edge, and siblings redistribute around the fixed bottom). A plain `mt-2` or
a conditionally-rendered paragraph below the input is exactly this bug.

Two techniques enforce the rule, pick whichever fits:
- **Reuse an existing box's slot instead of stacking a new one.** One Stop's
  question card (boarding-pass shaped: a dashed-divider stub on the left
  holding the flag — or a plane glyph `✈` when revealing it would spoil a
  capital→country answer — with the prompt text to its right) swaps its own
  content to show the correction/roast on a wrong answer, rather than a
  second element appearing above/below it. Same box, different content, so
  its height changing doesn't introduce a *new* sibling to shift around.
- **Absolutely-position anything that can't reuse a slot.** Manifest's
  "Already got X" / "not finding that one" hint, and each mode's Next-style
  control, are `absolute` overlays (`bottom-full`/`top-full` relative to a
  `relative` wrapper around the input) rather than flow siblings — appearing
  or disappearing doesn't add flow height at all. Animate conditionally-
  shown ones via opacity/translate on an always-mounted element (never
  conditionally *mount* — mount/unmount pops instead of transitions), gated
  with `disabled`/`pointer-events-none`/`tabIndex={-1}` while hidden so
  they're not clickable/focusable.

One Stop's Skip and Give-up (and, once answered, Next) are icon buttons (no
text labels — `title` for the tooltip) flanking the input row; Skip and Next
share one slot, swapping icon/handler by feedback state rather than adding a
second control. While feedback is showing, the non-actionable one dims to
40% opacity and gets `.spin-slow` (a slow continuous idle turn) instead of
vanishing (conditionally mounting them was the original bug there too). A
wrong answer also gets `.shake-subtle` (lower amplitude than the shared
`.shake-once`, scoped to this panel) and the input clears itself ~350ms
after the shake via a `setTimeout` effect, rather than sitting there
readOnly showing the wrong guess until Next.

A correct answer never shows text feedback — swapping the submit button
(`✈`) for a checkmark badge (`.pop-in`, a plain-HTML version of
`.map-pop-in` since `fill-box` transform-box is SVG-only) is the entire
"correct" signal, then it auto-advances after 800ms.

One Stop requires explicit submission (Enter/Submit) — it *had* live
auto-submit-while-typing (the same `isExactMatch` mechanism Terra Incognita
still uses) but it was deliberately removed: firing before Enter is pressed
is itself a tell ("it just submitted" = "I was right"), so the game moving
the moment you finish typing leaked the answer ahead of committing to it.
Terra Incognita keeps live auto-submit (`maybeAutoSubmit`) — the map itself
already shows you the answer, so there's no equivalent tell to leak, and
Manifest's identical experiment was reverted earlier for an unrelated
reason (ISO alt-code false positives, see Answer matching above). Don't
assume the three modes are consistent on this — check each one.

## Border mode (Frontiers)

The fourth format (`format === "borders"`, displayed as "Frontiers"). Asks
about which countries border which, rather than capitals/flags/map location.
Lives mostly in `engine.ts`'s Border section and `BorderPlay.tsx`, and reuses
`CountryMaxxing.tsx`'s existing generic summary screen — `BorderPlay` never
implements its own; `BorderResult` is deliberately shaped identically to
`PromptAndAnswerResult` (`{ correct, total, remaining? }`) so it slots in with
zero new summary code.

**Three question types**, settable individually or as `"mixed"` via
`BorderQuestionTypeSetting`:
- `name-neighbors` — "Name all the countries bordering X" (multi-answer,
  tracked via `foundNeighborCca3s`, auto-completes when the full set is found)
- `reverse-lookup` — "Which country borders all of: A, B, C?" (the subject
  country is a spoiler until answered — `safeToReveal` in `BorderPlay.tsx`
  gates whether the map shows it)
- `longest-shortest` — "Which of X's neighbors does it share its
  longest/shortest border with?", resolved via `longestShortestNeighbor()`
  against `borderLengths.ts`'s real data

Not every country is eligible for every type — island nations with zero land
neighbors are eligible for none; countries with exactly one neighbor skip
`longest-shortest` (nothing to compare); `reverse-lookup` additionally
requires the subject to be the *only* country in the whole dataset with that
exact neighbor set (`uniquelyIdentifiedByNeighbors()`), checked globally, not
against the current region pool. Several real countries share an identical
neighbor set — Papua New Guinea/Timor-Leste (both border only Indonesia),
San Marino/Vatican City (both border only Italy), Bhutan/Nepal (both border
exactly {China, India}), UAE/Yemen (both border exactly {Oman, Saudi
Arabia}) — which made "which country borders all of: X" genuinely
ambiguous for any of them: a correct-but-unintended guess got marked wrong.
This is computed dynamically off `allCountries`, not a hardcoded exclusion
list, so it self-corrects if the country/border data ever changes. **A
single-neighbor `reverse-lookup` question also gets its own phrasing** —
"Which country's only land border is with X?" instead of the "borders all
of: X" phrasing built for 2+, which read oddly for exactly one clue.

**`borderEligiblePool(pool,
typeSetting)`, not the raw region pool, is the count of "how many questions
this session can contain."** Real bug hit building this: Border mode silently
skips ineligible countries from its own internal queue, but if something
upstream computes session size from the raw pool (the Depart-button country
count, the summary's "N / total mastered" math), it overcounts and shows
never-asked countries as falsely "mastered." `CountryMaxxing.tsx` runs `pool`
through `borderEligiblePool` before it reaches `BorderPlay` or the summary —
any new code computing Border-mode session size must do the same.

`borderLengths.ts` — sourced from Wikipedia's "List of countries and
territories by land borders" via the MIT-licensed `DataOmbudsman/country-graph`
GitHub repo (itself compiled from CC-BY-SA Wikipedia data); Kosovo's four
entries (omitted upstream as a disputed state) were hand-added from the CIA
World Factbook, cross-checked against two independent mirrors. Deliberately
excludes dependent territories not in the app's own 197-country pool (French
Guiana, Hong Kong, etc.) and the Sri Lanka/India pair — see `BAD_BORDERS` in
`countries.ts`, a confirmed `world-countries` data error (they're separated by
the Palk Strait, no land border exists) caught by cross-referencing this
dataset. 158 countries, 315 unique pairs, validated 0 missing/0 asymmetric.

`BorderPlay.tsx` follows the same "nothing shifts the input" pattern as the
other three modes (see above) — same boarding-pass question box, same
merged Skip/Give-up/Next icon buttons — despite its UI branching by question
type, since that rule applies regardless of mode.

## Mobile keyboard handling

All four play screens use `useKeyboardInset()` (`core/useKeyboardInset.ts`)
rather than trusting `h-dvh` alone. iOS Safari's `100dvh` doesn't shrink for
the on-screen keyboard — it only accounts for browser chrome — so a
`bottom-4` input can end up genuinely hidden behind the keyboard there, not
just cramped. The hook tracks `window.visualViewport` directly (the real
covered height, regardless of browser) and each screen applies it as an
inline `style={{ bottom: keyboardInset + 16 }}` override on its bottom
panel(s) once a keyboard is actually open.

Three of the four also shrink the map (`h-[35dvh]` instead of `h-full`,
animated) while `keyboardInset > 0`, trading map space for a bigger answer
panel — safe because the map is supplementary there (One Stop, Manifest,
Frontiers all ask a textual question). **Terra Incognita deliberately
doesn't** — the map *is* the question there (you're identifying the
highlighted country), so shrinking it while answering would work against
the mode instead of just tidying up space. Don't copy the shrink into a
future map-dependent mode without the same exception.

Test this without a real device: `Object.defineProperty(window.
visualViewport, 'height', { configurable: true, get: () => X })` then
`window.visualViewport.dispatchEvent(new Event('resize'))` simulates a
keyboard covering `realHeight - X` px — `delete` the property afterward to
restore native behavior.

## Design direction

Vintage travel-poster / atlas aesthetic: warm paper / deep-navy neutrals
(not flat gray), Lora serif for display type, Jost for uppercase-tracked
labels, Inter for body copy. Decorative motifs (compass rose, dotted flight
paths, passport-stamp buttons, luggage-tag chips, boarding-pass CTA) are
drawn from real travel/cartography ephemera on purpose, not generic
"playful app" tropes. **No mascot or cutesy character** — tried one, explicitly
cut it; the personality lives in copy and motif, not a character.

Both themes are real work, not a naive invert — `@theme` defines light
values, and every component pairs each utility with its `dark:` counterpart
by hand (`text-ink dark:text-ink-dark`, etc.) rather than swapping a single
token.

**Theme resolution** (`core/theme.ts`): Tailwind's `dark:` variant is
repointed from the default `prefers-color-scheme` media query to a `.dark`
class on `<html>` via `@custom-variant dark (&:where(.dark, .dark *));` in
`index.css` — this is what makes an explicit override possible, since a
media query can't be overridden by a click. `theme.ts` still *defaults*
the class from the OS preference and follows it live via a
`matchMedia("change")` listener, but only until `setTheme()` stores an
explicit choice (`countrymaxxing:theme` in localStorage) — after that the
stored choice wins and the listener no-ops. `index.html` has a small
blocking inline `<script>` duplicating the same read-storage-or-fall-back-
to-system logic, applied before first paint — it can't import `theme.ts`
since it has to run before any module script loads, so if the storage key
or fallback logic ever changes, update both places. `<DarkModeToggle>`
(mirrors `SoundToggle`'s pattern) sits in every play screen's top bar plus
the setup screen's hero and the (currently unreachable) shelf header.

## Testing

No test suite. Verify UI changes by running the dev server and driving it
via browser automation (screenshot + read console for errors after
non-trivial changes) — this project has no user readily available to
click through changes themselves, so that verification step isn't optional.

**Screenshots can lie at resized/unusual window dimensions.** After using
the browser tool's window-resize (e.g. testing mobile widths), screenshots
have shown stale/mis-scaled captures — content rendered as cut off or with
large blank gaps that doesn't match reality. Cross-check anything that looks
like an overflow/clipping bug with real DOM measurements before trusting the
pixels: `element.getBoundingClientRect()` vs `window.innerWidth`,
`document.documentElement.scrollWidth`, and `el.scrollWidth > el.clientWidth`
for text clipping. A full page reload (not just re-screenshotting) sometimes
clears the stale capture; if the measurements say it's fine, believe them
over the screenshot. A heading that's a single unbroken word (e.g.
"CountryMaxxing") needs an explicit responsive size (`text-4xl sm:text-5xl
md:text-6xl`, not a bare `text-6xl`) — CSS can't wrap one word, so at a fixed
large size it silently overflows/clips on narrow viewports instead.

You can `await import('/src/path/to/file.ts')` directly in the page's own
console/`javascript_tool` (Vite dev server serves ES modules) to inspect
real exported data/logic — e.g. checking a `countries.ts` entry's fields, or
calling `isCloseMatch` with real candidates — without navigating the UI into
the exact state needed to observe it indirectly.
