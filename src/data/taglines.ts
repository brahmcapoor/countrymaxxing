// The setup screen's hero subtitle — one picked at random per visit, same
// "small recurring surprise" idea as loadingMessages.ts. Keep these short;
// the hero renders them uppercase with heavy letter-spacing, so anything
// longer than the original wraps awkwardly at narrow widths.
const TAGLINES = [
  "197 Countries. Zero Frequent Flyer Miles.",
  "197 Countries. Zero Baggage Fees.",
  "All The Borders, None Of The Jet Lag.",
  "World Domination, One Capital At A Time.",
  "197 Countries. One Browser Tab.",
  "No Passport Required. No Layovers Either.",
  "Cheaper Than A Plane Ticket. Slower Than Google Maps.",
  "Geography Cosplay For Introverts.",
];

export function randomTagline(): string {
  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)]!;
}
