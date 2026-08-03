// A dotted abbreviation like "D.C." survives the punctuation-to-space
// replace below as two separate single-letter words ("d", "c"), which then
// fails wordsMatch's equal-word-count check against "dc" typed as one word
// (e.g. "Washington D.C." vs. "washington dc"). Collapsing runs of
// single-letter words back into one token fixes this generally, not just
// for D.C.
function collapseInitials(input: string): string {
  const words = input.split(" ").filter(Boolean);
  const result: string[] = [];
  let initials = "";
  for (const word of words) {
    if (word.length === 1) {
      initials += word;
      continue;
    }
    if (initials) {
      result.push(initials);
      initials = "";
    }
    result.push(word);
  }
  if (initials) result.push(initials);
  return result.join(" ");
}

function normalize(input: string): string {
  return collapseInitials(
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  )
    // "St" is near-universally short for "Saint" in this domain (St Lucia,
    // St Vincent, St Kitts) — expanding it lets the common abbreviation
    // through without needing an equal-word-count fuzzy match to bridge it.
    .replace(/\bst\b/g, "saint");
}

// Optimal string alignment distance (Levenshtein + adjacent transpositions),
// so a common typing slip like "Freetwon" for "Freetown" still counts as one edit.
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1);
      }
    }
  }
  return dp[m]![n]!;
}

// Per-word typo budget — deliberately tight so dropping or mangling a whole
// word (e.g. typing "si" for "Seri" in "Bandar Seri Begawan") fails, even
// though that edit would be cheap relative to the full phrase's length.
//
// The <=7 cutoff (rather than a rounder <=8 or <=10) is load-bearing: it's
// tuned to keep "Freetwon" forgiven for "Freetown" (8, a genuine adjacent-key
// slip) while requiring "Tallinn" (7) spelled exactly — dropping one of a
// doubled letter is a real gap in knowing the spelling, not a fumbled
// keystroke, and at 7 letters or fewer that single dropped/duplicated letter
// is cheap enough to sneak under a budget of 1.
function wordBudget(length: number): number {
  if (length <= 7) return 0;
  if (length <= 12) return 1;
  return 2;
}

function wordsMatch(inputWords: string[], candidateWords: string[]): boolean {
  if (inputWords.length !== candidateWords.length) return false;
  return inputWords.every((word, i) => {
    const target = candidateWords[i]!;
    return word === target || editDistance(word, target) <= wordBudget(target.length);
  });
}

export function isCloseMatch(input: string, candidates: string[]): boolean {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return false;
  const inputWords = normalizedInput.split(" ");

  return candidates.some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate) return false;
    if (normalizedInput === normalizedCandidate) return true;
    return wordsMatch(inputWords, normalizedCandidate.split(" "));
  });
}

// For live auto-submit-while-typing: the fuzzy typo tolerance in isCloseMatch
// is exactly what makes it unsuitable there — "New Delh" is within budget of
// "New Delhi" and would credit an answer that isn't finished yet. Explicit
// submission (Enter/Submit) should still forgive typos; only the live check
// needs to wait for a real, complete match.
export function isExactMatch(input: string, candidates: string[]): boolean {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return false;
  return candidates.some((candidate) => normalize(candidate) === normalizedInput);
}
