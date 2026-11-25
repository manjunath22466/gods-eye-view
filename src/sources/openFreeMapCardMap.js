import {
  createOpenFreeMapSource,
  registerOpenFreeMapProjection,
} from './openFreeMap.js';

/**
 * The card's maps (the close-up map and pinned map stills) from the same
 * OpenFreeMap tiles the traffic layer and outlines read, through the same
 * bounded fetch and decode owner. A tile is kept as a small plain copy of
 * what the card map draws (its areas, roads, water and the names of places,
 * major roads and water, in a coarse 1024-unit grid), read back as a vector
 * tile for the painter.
 */

/** The grid a kept tile's coordinates are rounded to. */
export const CARD_MAP_EXTENT = 1024;

/**
 * The name fields a name is read from: the local name, its Latin form and
 * the name in each language the app is offered in (OpenMapTiles' `name:xx`).
 */
export const CARD_MAP_NAME_KEYS = Object.freeze([
  'name',
  'name:latin',
  ...[
    'ar',
    'de',
    'en',
    'es',
    'fr',
    'he',
    'it',
    'ja',
    'pt',
    'ru',
    'sv',
    'uk',
    'zh',
    'zh-Hans',
    'zh-Hant',
  ].map((language) => `name:${language}`),
]);

/** Source layers the card map draws, with the properties it reads. */
export const CARD_MAP_TILE_LAYERS = Object.freeze({
  water: ['class'],
  landcover: ['class'],
  landuse: ['class'],
  park: ['class'],
  waterway: ['class'],
  aeroway: ['class'],
  transportation: ['class', 'brunnel'],
  place: ['class', 'rank', ...CARD_MAP_NAME_KEYS],
  transportation_name: ['class', ...CARD_MAP_NAME_KEYS],
  water_name: ['class', ...CARD_MAP_NAME_KEYS],
  // Last: buildings are left out first when a tile is too dense.
  building: [],
});

/** Coordinates kept per tile, under the shared owner's own hard cap. */
const MAX_NUMBERS = 200_000;
const LAYER_FEATURE_LIMIT = 40_000;
const TYPE_NAMES = { 1: 'Point', 2: 'LineString', 3: 'Polygon' };

/**
 * One parsed OpenMapTiles tile as the card map keeps it: per layer, each
 * feature's type, the properties drawn and its parts as flat `[x, y, ...]`
 * arrays in a {@link CARD_MAP_EXTENT} grid, repeated points dropped.
 * @param {Uint8Array} _bytes
 * @param {number} _z
 * @param {number} _x
 * @param {number} _y
 * @param {{layers: Record<string, any>}} tile The parsed vector tile.
 */
export function projectCardMapTile(_bytes, _z, _x, _y, tile) {
  const layers = {};
  let numbers = 0;
  for (const [name, keys] of Object.entries(CARD_MAP_TILE_LAYERS)) {
    const layer = tile?.layers?.[name];
    if (!layer || layer.length > LAYER_FEATURE_LIMIT) continue;
    const k = CARD_MAP_EXTENT / layer.extent;
    const features = [];
    for (let i = 0; i < layer.length && numbers < MAX_NUMBERS; i++) {
      const feature = layer.feature(i);
      if (!TYPE_NAMES[feature.type]) continue;
      const minimum = feature.type === 3 ? 4 : feature.type === 2 ? 2 : 1;
      const parts = [];
      for (const ring of feature.loadGeometry()) {
        const flat = [];
        let px = NaN;
        let py = NaN;
        for (const point of ring) {
          const x = Math.round(point.x * k);
          const y = Math.round(point.y * k);
          if (x === px && y === py && feature.type !== 1) continue;
          flat.push(x, y);
          px = x;
          py = y;
        }
        if (flat.length / 2 >= minimum) parts.push(flat);
        numbers += flat.length;
      }
      if (!parts.length) continue;
      const properties = {};
      for (const key of keys) {
        const value = feature.properties[key];
        if (value !== undefined && value !== null) properties[key] = value;
      }
      features.push({ type: feature.type, properties, parts });
    }
    if (features.length) layers[name] = features;
  }
  return { extent: CARD_MAP_EXTENT, layers };
}

registerOpenFreeMapProjection('cardMap', projectCardMapTile);

/**
 * A kept tile read as a vector tile (`layers[name].feature(i)`, with
 * `loadGeometry()`), as the vector base painter reads one.
 * @param {ReturnType<typeof projectCardMapTile>|null} kept
 */
export function cardMapVectorTile(kept) {
  const layers = {};
  for (const [name, features] of Object.entries(kept?.layers ?? {}))
    layers[name] = {
      name,
      extent: kept.extent,
      length: features.length,
      feature(i) {
        const { type, properties, parts } = features[i];
        return {
          type,
          properties,
          id: undefined,
          loadGeometry: () =>
            parts.map((flat) => {
              const points = [];
              for (let p = 0; p < flat.length; p += 2)
                points.push({ x: flat[p], y: flat[p + 1] });
              return points;
            }),
        };
      },
    };
  return { layers };
}

/**
 * The card map's tile source: OpenFreeMap through the shared decode owner,
 * with its own small cache and four requests at most at a time.
 * @param {object} [options] Passed to `createOpenFreeMapSource`.
 */
export function createCardMapSource(options = {}) {
  return createOpenFreeMapSource({
    projection: 'cardMap',
    maxEntries: 32,
    maxCacheBytes: 8 * 1024 * 1024,
    concurrency: 4,
    maxTiles: 9,
    ...options,
  });
}
