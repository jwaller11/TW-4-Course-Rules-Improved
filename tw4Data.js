// tw4Data.js
// Master data index. Load this after courseRulesData.js, airports.js, points.js, polygons.js, and lineMetadata.js.
window.TW4_DATA = {
  geometry: window.TW4_COURSE_RULES_DATA || { features: [] },
  airports: window.TW4_AIRPORTS || [],
  points: window.TW4_POINTS || [],
  polygons: window.TW4_POLYGONS || [],
  lineMetadata: window.TW4_LINE_METADATA || {}
};

window.TW4_ALL_REFERENCE_FEATURES = [
  ...(window.TW4_AIRPORTS || []),
  ...(window.TW4_POINTS || []),
  ...(window.TW4_POLYGONS || [])
];
