/**
 * @module maps/attribution
 * @description The on-map credits of the map stacks' sources, and Esri
 * World Imagery's tile address, which the globe and the card previews share.
 */

// Attribution and service rights are documented in DATA_SOURCES.md.
/** Esri World Imagery's tiles; Stories' card images draw from the same. */
export const ESRI_TILES =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
/** Esri World Imagery's credit line, as plain text. */
export const ESRI_IMAGERY_CREDIT =
  'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
/**
 * Esri's World Boundaries and Places reference tiles: place names and
 * borders, drawn over World Imagery on the card's close-up map.
 */
export const ESRI_PLACES_TILES =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
/** World Imagery's credit with the reference layer's sources after it, as plain text. */
export const ESRI_IMAGERY_PLACES_CREDIT = `${ESRI_IMAGERY_CREDIT}; labels: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community`;
/**
 * The same credit with every source still named, short enough to show on a
 * card's small map; the long line is its title.
 */
export const ESRI_IMAGERY_PLACES_CARD_CREDIT =
  'Powered by Esri · Esri, Maxar, Earthstar Geographics, GIS User Community · Labels: HERE, Garmin, © OpenStreetMap contributors';
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';
