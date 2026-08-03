// Countries whose shape can't be usefully shown as a normal filled polygon:
// Tuvalu (TUV) and Kosovo (UNK) have no shape at all in world-atlas's 50m
// topology (a gap in the source data); Kiribati (KIR) has a shape that
// projects correctly but is ~33 atolls scattered across 145° of longitude —
// even rendered accurately, that's imperceptible specks, not an
// identifiable shape. Cape Verde (CPV) is a real, correctly-projected
// 8-island shape, but at a whole-region or whole-world fit it renders as a
// few-pixel speck — same practical problem as Kiribati, smaller scale.
//
// Contexts that show one country at a time and can afford a dedicated inset
// (Map Identify, Prompt & Answer) should render these countries' real shape
// there instead of reducing them to a marker — see MAP_ALWAYS_INSET.
// Contexts that just need to indicate "found"/"highlighted" across many
// countries at once (Name All) can use a marker for all of them uniformly.
//
// This is "known cases as found," not an automatic detector — if another
// small or far-flung archipelago turns out to have the same problem, add it
// here.
export const MAP_HARD_TO_RENDER: ReadonlySet<string> = new Set(["TUV", "UNK", "KIR", "CPV"]);

// Of the above, these get a dedicated auto-zoom inset (fit to their own true
// bounding box) instead of being replaced with a marker — seeing the real
// shape (scattered atolls, or a small island cluster) is the point when it's
// the thing being identified, and their bounding box is small enough that
// zooming to it is meaningful rather than just re-showing empty ocean.
export const MAP_ALWAYS_INSET: ReadonlySet<string> = new Set(["KIR", "CPV"]);

// Topology (ccn3) ids to skip drawing entirely, regardless of pool/focus —
// not part of the 197-country set (per countries.ts's independence filter)
// and their geometry duplicates territory world-atlas already draws as part
// of a country that IS in the set. Western Sahara (732) is baked into
// Morocco's (504) own polygon *and* separately drawn as its own feature
// right after it in the topology — since Western Sahara is out of scope, it
// renders faded and paints on top, visually cutting a "gap" into Morocco's
// already-complete shape. Skipping it entirely leaves Morocco's one true
// shape intact. Keyed by ccn3 (not cca3) since these territories aren't in
// our Country dataset at all to have a cca3 from.
export const MAP_EXCLUDE_RENDER: ReadonlySet<string> = new Set(["732"]);
