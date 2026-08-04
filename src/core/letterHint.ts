// Turns an answer into a hangman-style scaffold — every third letter shown,
// the rest blanked to "_"; spaces/apostrophes/hyphens always pass through
// untouched (they're structure, not something to guess). The reveal
// pattern is deterministic (not random) so it stays stable across
// re-renders instead of reshuffling on every keystroke.
export function letterHint(answer: string): string {
  let letterIndex = 0;
  const slots = Array.from(answer).map((ch) => {
    if (!/[a-zA-Z]/.test(ch)) return ch;
    const reveal = letterIndex % 3 === 0;
    letterIndex++;
    return reveal ? ch : "_";
  });
  return slots.join(" ");
}
