// Countries whose shape can't be usefully shown as a normal filled polygon:
// Tuvalu (TUV) has no shape at all in world-atlas's 50m topology (a gap in
// the source data); Kiribati (KIR) has a shape that projects correctly but
// is 19 atolls in three island groups scattered from 169°E to 152°W — even
// rendered accurately, that's imperceptible specks, not an identifiable
// shape. Cape Verde (CPV) is a real, correctly-projected 8-island shape, but
// at a whole-region or whole-world fit it renders as a few-pixel speck —
// same practical problem as Kiribati, smaller scale.
//
// Kosovo (UNK) used to be here too — world-atlas's polygon for it is real,
// recognizable geography, just filed under no ISO code at all (`id:
// undefined`, alongside several territories not in our country set) instead
// of a usable one. WorldMap.tsx now re-attaches that same polygon to a real
// id (see its KOSOVO_FEATURE and kosovoGeometry.ts) rather than falling back
// to a marker, so it no longer belongs in this "no usable shape" list.
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
export const MAP_HARD_TO_RENDER: ReadonlySet<string> = new Set(["TUV", "KIR", "CPV"]);

// Of the above, these get a dedicated auto-zoom inset instead of being
// replaced with a marker — seeing the real shape (a small island cluster, or
// a chain of atolls) is the point when it's the thing being identified.
//
// The inset frames the island group around the country's capital, not its
// full bounding box: fitting the full box works for Cape Verde, whose whole
// extent *is* one group, but for Kiribati it meant framing 39° of ocean to
// show three specks — and worse once a multi-region fit rotated the
// projection's seam through the country, at which point the "close-up" was a
// picture of the entire world. The play screens pass these countries as a
// ccn3 → capital map for that reason (WorldMap's alwaysInsetFocusByCcn3);
// adding one here means adding it there too, not just to this set.
export const MAP_ALWAYS_INSET: ReadonlySet<string> = new Set(["KIR", "CPV"]);

// Countries whose real shape renders fine (unlike MAP_HARD_TO_RENDER above —
// these don't need a marker or an inset) but whose topology feature also
// includes real overseas territory far enough from the mainland that the
// feature's bounding box centers on open ocean between the two, nowhere the
// country actually is. Confirmed by measuring: France's box (mainland +
// French Guiana + Réunion/Mayotte) centers ~28° from the nearest point of its
// own geometry; Netherlands (mainland + Aruba/Curaçao) ~36°; Chile (mainland
// + Easter Island) ~9°. Tonga's own three real island groups (Tongatapu,
// Ha'apai, Vava'u) are all much closer together, but its capital's group
// still sits ~1.2° off the full-shape center — same fix, tighter radius (see
// WorldMap's BOUNDS_FOCUS_RADIUS_DEGREES). That center feeds the current-
// question locator ring, the auto-zoom anchor, and the portrait scroll-to-
// center (see WorldMap's `built.bounds`), so a country here got a "pulse"
// floating in mid-ocean instead of over its own territory — see
// boundsFocusByCcn3, which measures just the group around each one's capital
// instead of the full feature.
//
// Known cases as found, same as MAP_HARD_TO_RENDER above — if another
// country with far-flung real territory turns out to have the same problem,
// add it here.
export const MAP_SCATTERED_TERRITORY: ReadonlySet<string> = new Set(["FRA", "NLD", "CHL", "TON"]);

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
