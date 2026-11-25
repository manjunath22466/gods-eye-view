/**
 * @module ui/cardMapStyle
 * @description The look of the card's maps (the close-up map and pinned map
 * stills), drawn from OpenFreeMap's OpenMapTiles vector tiles by the vector
 * base painter. The dark style uses near-black land, dark water, bright
 * roads (major roads thicker and lighter), and muted parks and buildings.
 * A MapLibre style document draws the ground from the tile's own layers.
 * Names are placed over the whole map afterwards (cardMapLabels.js), as
 * {@link CARD_MAP_LABELS} sets them.
 */

/** The name the style gives the card map's one vector source. */
export const CARD_MAP_SOURCE = 'openmaptiles';

/** The deepest zoom OpenFreeMap's tiles are cut at; deeper is over-zoomed. */
export const CARD_MAP_SOURCE_MAXZOOM = 14;

/** Road classes from the thinnest up; each is a layer, the major on top. */
const ROADS = Object.freeze([
  ['path', ['path', 'track']],
  ['service', ['service']],
  ['minor', ['minor']],
  ['tertiary', ['tertiary']],
  ['secondary', ['secondary']],
  ['primary', ['primary', 'trunk']],
  ['motorway', ['motorway']],
]);

/** A road's width in CSS pixels at card zooms 11, 14 and 16. */
const ROAD_WIDTHS = Object.freeze({
  path: [0, 0.3, 0.9],
  service: [0, 0.5, 1.6],
  minor: [0.3, 1, 3],
  tertiary: [0.6, 1.8, 4],
  secondary: [0.8, 2.4, 5],
  primary: [1.2, 3.2, 6.5],
  motorway: [1.6, 4, 8],
});

/** Roads that carry a soft halo. */
const GLOWING = new Set(['secondary', 'primary', 'motorway']);

/** The card map's dark palette and the halo under major roads. */
export const CARD_MAP_COLOURS = Object.freeze({
  land: '#06080b',
  water: '#0b1a2a',
  green: '#0d1711',
  building: '#141a20',
  buildingEdge: '#1c232b',
  runway: '#232a32',
  rail: '#2e353d',
  glow: 'rgba(255, 255, 255, 0.07)',
  names: '#e4ebf0',
  nameHalo: 'rgba(6, 8, 11, 0.92)',
  waterNames: '#6f8fae',
  roads: Object.freeze({
    path: '#262d34',
    service: '#38414a',
    minor: '#5c6670',
    tertiary: '#97a1aa',
    secondary: '#c2cad1',
    primary: '#e9edf0',
    motorway: '#fff4dc',
  }),
});

/** The original light toner palette for card maps. */
const TONER_COLOURS = Object.freeze({
  land: '#ffffff',
  water: '#141414',
  green: '#e6e6e6',
  building: '#d2d2d2',
  buildingEdge: '#bdbdbd',
  runway: '#9a9a9a',
  rail: '#7a7a7a',
  glow: null,
  names: '#000000',
  nameHalo: 'rgba(255, 255, 255, 0.95)',
  waterNames: '#5a5a5a',
  roads: Object.freeze({
    path: '#8c8c8c',
    service: '#5a5a5a',
    minor: '#2a2a2a',
    tertiary: '#111111',
    secondary: '#000000',
    primary: '#000000',
    motorway: '#000000',
  }),
});

export function cardMapColours(theme) {
  return theme === 'toner' ? TONER_COLOURS : CARD_MAP_COLOURS;
}

/** Card zooms the widths are given at. */
const WIDTH_ZOOMS = [11, 14, 16];

/**
 * A value at card zooms (CSS pixels) as the painter reads it: a tile painted
 * `256 * scale` pixels wide at zoom `z` is painted at style zoom
 * `z + log2(scale) - 1`, its sizes in its own pixels.
 */
function sized(values, scale) {
  const shift = Math.log2(scale) - 1;
  return [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    ...WIDTH_ZOOMS.flatMap((zoom, i) => [zoom + shift, values[i] * scale]),
  ];
}

const classIn = (classes) => ['match', ['get', 'class'], classes, true, false];

/**
 * The card map style document.
 * @param {{theme?: 'dark'|'toner', scale?: number, tiles?: string}} [options] `scale`: device pixels
 *   per CSS pixel the tiles are painted at (1 or 2); `tiles`: the source's
 *   tile address.
 * @returns {object} A MapLibre style document.
 */
export function cardMapStyle({
  theme = 'dark',
  scale = 1,
  tiles = 'cardmap://tile/{z}/{x}/{y}',
} = {}) {
  const c = cardMapColours(theme);
  const source = CARD_MAP_SOURCE;
  const fill = (id, sourceLayer, color, filter, extra = {}) => ({
    id,
    type: 'fill',
    source,
    'source-layer': sourceLayer,
    ...(filter && { filter }),
    paint: { 'fill-color': color, ...extra },
  });
  const tunnelFaded = ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.35, 1];
  const roads = ROADS.flatMap(([name, classes]) => {
    const widths = ROAD_WIDTHS[name];
    const line = (id, color, width, opacity) => ({
      id,
      type: 'line',
      source,
      'source-layer': 'transportation',
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        classIn(classes),
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': sized(width, scale),
        'line-opacity': opacity,
      },
    });
    const layers = [];
    if (c.glow && GLOWING.has(name))
      layers.push(
        line(
          `road-${name}-glow`,
          c.glow,
          widths.map((w) => w * 3),
          tunnelFaded,
        ),
      );
    layers.push(line(`road-${name}`, c.roads[name], widths, tunnelFaded));
    return layers;
  });
  return {
    version: 8,
    name: theme === 'toner' ? 'card-map-toner' : 'card-map-dark',
    sources: {
      [source]: {
        type: 'vector',
        tiles: [tiles],
        minzoom: 0,
        maxzoom: CARD_MAP_SOURCE_MAXZOOM,
      },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': c.land } },
      fill(
        'green',
        'landcover',
        c.green,
        classIn(['wood', 'grass', 'wetland']),
      ),
      fill(
        'parks-landuse',
        'landuse',
        c.green,
        classIn(['park', 'cemetery', 'pitch', 'stadium', 'playground']),
      ),
      fill('parks', 'park', c.green),
      fill('water', 'water', c.water),
      {
        id: 'waterway',
        type: 'line',
        source,
        'source-layer': 'waterway',
        filter: classIn(['river', 'canal', 'stream']),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.water,
          'line-width': sized([0.6, 1.6, 4], scale),
        },
      },
      {
        id: 'runway',
        type: 'line',
        source,
        'source-layer': 'aeroway',
        filter: classIn(['runway', 'taxiway']),
        paint: {
          'line-color': c.runway,
          'line-width': sized([1, 4, 12], scale),
        },
      },
      fill('buildings', 'building', c.building, undefined, {
        'fill-outline-color': c.buildingEdge,
      }),
      {
        id: 'rail',
        type: 'line',
        source,
        'source-layer': 'transportation',
        filter: classIn(['rail', 'transit']),
        paint: {
          'line-color': c.rail,
          'line-width': sized([0.4, 0.8, 1.4], scale),
          'line-dasharray': [3, 2],
        },
      },
      ...roads,
    ],
  };
}

/**
 * How the card map's names are set, in CSS pixels: place names by rank
 * (the lower `priority`, the sooner placed), names along major roads, and
 * names of open water. Fonts are the system's, a stack that covers Latin,
 * Cyrillic, Greek, CJK, Arabic, Hebrew, Devanagari and Thai; no font is
 * loaded from the network.
 */
export const CARD_MAP_LABELS = Object.freeze({
  font: [
    'system-ui',
    '-apple-system',
    '"Segoe UI"',
    '"Noto Sans"',
    '"Hiragino Sans"',
    '"PingFang SC"',
    '"Microsoft YaHei"',
    '"Noto Sans CJK JP"',
    '"Noto Sans Arabic"',
    '"Noto Sans Hebrew"',
    '"Noto Sans Devanagari"',
    '"Noto Sans Thai"',
    'Tahoma',
    'sans-serif',
  ].join(', '),
  places: Object.freeze({
    city: Object.freeze({ priority: 0, size: 15, weight: 700 }),
    town: Object.freeze({ priority: 1, size: 13, weight: 700 }),
    village: Object.freeze({ priority: 2, size: 12, weight: 600 }),
    suburb: Object.freeze({ priority: 3, size: 11, weight: 600 }),
    quarter: Object.freeze({ priority: 4, size: 10, weight: 600 }),
    neighbourhood: Object.freeze({ priority: 4, size: 10, weight: 600 }),
  }),
  roads: Object.freeze({
    classes: Object.freeze(['motorway', 'trunk', 'primary', 'secondary']),
    priority: 5,
    size: 10,
    weight: 500,
    /** Names along roads on one map, at most. */
    most: 6,
  }),
  water: Object.freeze({
    classes: Object.freeze(['ocean', 'sea', 'bay', 'lake', 'river']),
    priority: 6,
    size: 10,
    weight: 400,
  }),
  /** The halo round each name. */
  halo: 3,
  /** Room kept clear round a name, and round the item's marker. */
  gap: 4,
  marker: 30,
});
