/**
 * @module ui/cardMap
 * @description Draws a card's map (the close-up map, a pinned map still) on
 * one canvas: OpenFreeMap's vector tiles round a spot at one zoom, painted
 * by the vector base painter in the card map's style (cardMapStyle.js). Each
 * tile of a drawing is painted once, when it loads, then the names over
 * them; there is no animation loop. A new drawing (a moved spot, another
 * size or language) is painted aside while a finished map stays shown. Tiles come through the shared OpenFreeMap owner (its
 * fetch limits and caches), and the painter itself never fetches.
 */
import { readonly, ref } from 'vue';
import {
  loadVectorStyle,
  paintVectorTile,
} from '../render/vectorBase/index.js';
import {
  cardMapVectorTile,
  createCardMapSource,
} from '../sources/openFreeMapCardMap.js';
import {
  cardMapColours,
  CARD_MAP_LABELS,
  CARD_MAP_SOURCE_MAXZOOM,
  cardMapStyle,
} from './cardMapStyle.js';
import { collectLabels, placeLabels } from './cardMapLabels.js';
import { tileBlock } from './mapTiles.js';
import { getLocale } from '../i18n/index.js';

const TILE = 256;

/** Device pixels per CSS pixel the map is painted at: 1, or 2 on a dense screen. */
export const cardMapScale = () =>
  (globalThis.devicePixelRatio || 1) >= 1.5 ? 2 : 1;

let source = null;
/** The one tile source every card map shares, made on first use. */
export const cardMapSource = () => (source ??= createCardMapSource());
/**
 * Use `next` as the card maps' tile source (a test's); returns a function
 * that puts the previous one back.
 */
export function setCardMapSource(next) {
  const previous = source;
  source = next;
  return () => {
    source = previous;
  };
}

const THEME_KEY = 'gev.cardMapTheme';

function savedTone() {
  try {
    return globalThis.localStorage?.getItem(THEME_KEY) === 'toner'
      ? 'toner'
      : 'dark';
  } catch {
    return 'dark';
  }
}

const selectedTheme = ref(savedTone());
export const cardMapTheme = readonly(selectedTheme);

export function toggleCardMapTheme() {
  selectedTheme.value = selectedTheme.value === 'dark' ? 'toner' : 'dark';
  try {
    globalThis.localStorage?.setItem(THEME_KEY, selectedTheme.value);
  } catch {
    // The live maps still share the choice without storage.
  }
}

const styles = new Map();
/** The map style, compiled once per theme and device scale. */
function compiledStyle(theme, scale) {
  const key = `${theme}@${scale}`;
  let style = styles.get(key);
  if (!style) {
    const document = cardMapStyle({ theme, scale });
    style = loadVectorStyle(`cardmap://style/${key}`, async () => ({
      ok: true,
      json: async () => document,
    }));
    style.catch(() => styles.delete(key));
    styles.set(key, style);
  }
  return style;
}

/** The painter is given tiles; any other it would read is none. */
const NO_FETCH = async () => ({ ok: false, status: 404 });

/**
 * Where a card map's tiles sit round its spot, in CSS pixels from the spot.
 * Without a `frame`, the 3 by 3 block of tiles the spot is in the middle of;
 * with one, the tiles a frame that size centred on the spot shows. The canvas
 * covers `left`, `top`, `width` and `height`.
 * @param {number} lat
 * @param {number} lon
 * @param {number} zoom
 * @param {{width: number, height: number}|null} [frame]
 */
export function cardMapLayout(lat, lon, zoom, frame = null) {
  const block = tileBlock(lat, lon, zoom).map((tile) => {
    const [, x, y] = tile.key.split('/').map(Number);
    return { key: tile.key, z: zoom, x, y, left: tile.left, top: tile.top };
  });
  if (!block.length) return { tiles: [], left: 0, top: 0, width: 0, height: 0 };
  if (frame) {
    const left = -Math.round(frame.width / 2);
    const top = -Math.round(frame.height / 2);
    const tiles = block.filter(
      (t) =>
        t.left < left + frame.width &&
        t.left + TILE > left &&
        t.top < top + frame.height &&
        t.top + TILE > top,
    );
    return { tiles, left, top, width: frame.width, height: frame.height };
  }
  const left = Math.min(...block.map((t) => t.left));
  const top = Math.min(...block.map((t) => t.top));
  return {
    tiles: block,
    left,
    top,
    width: Math.max(...block.map((t) => t.left)) + TILE - left,
    height: Math.max(...block.map((t) => t.top)) + TILE - top,
  };
}

/** A tile's geographic box, for the tile source's bounds check. */
function tileBox(z, x, y) {
  const n = 2 ** z;
  const lat = (row) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: lat(y),
    south: lat(y + 1),
  };
}

const isAbort = (error) => error?.name === 'AbortError';

/**
 * Draw a card map on `canvas`: the dark land at once, then each tile as
 * it loads, then the names over the whole map (cardMapLabels.js). `onState`
 * hears `loading`, then `ready` (some tiles or all drawn) or `failed` (none
 * could be read: the plain land stays).
 * @param {HTMLCanvasElement} canvas
 * @param {{lat: number, lon: number, zoom: number,
 *   frame?: {width: number, height: number}|null,
 *   view?: {left: number, top: number, width: number, height: number}|null,
 *   clearBottom?: number, locale?: string, theme?: 'dark'|'toner',
 *   onState?: (state: 'loading'|'ready'|'failed') => void}} options
 *   `view`: what shows of the map, in CSS pixels from the spot (the whole
 *   canvas unless given); names lie wholly inside it, clear of the marker on
 *   the spot and of a strip `clearBottom` high at its foot. `locale`: the
 *   language names are read in (the app's).
 * @returns {{done: Promise<void>, destroy: () => void}} `destroy` stops
 *   every request and frees the working canvas; the drawn canvas is the
 *   caller's.
 */
// Canvases that show a finished map, kept until a redraw is copied over.
const finished = new WeakSet();

export function drawCardMap(
  canvas,
  {
    lat,
    lon,
    zoom,
    frame = null,
    view = null,
    clearBottom = 0,
    locale = getLocale(),
    theme = 'dark',
    onState = () => {},
    onFrame = () => {},
  },
) {
  const controller = new AbortController();
  const { signal } = controller;
  let scratch = null;
  // A canvas that already shows a finished map keeps it until the redraw is
  // done: the redraw is painted aside and copied over in one step.
  let back = null;
  const kept = new Map();
  const plain = new Map();
  const free = () => {
    kept.clear();
    plain.clear();
    if (scratch) scratch.width = scratch.height = 0;
    scratch = null;
    if (back) back.width = back.height = 0;
    back = null;
  };
  const destroy = () => {
    controller.abort();
    free();
  };
  const layout = cardMapLayout(lat, lon, zoom, frame);
  const scale = cardMapScale();
  const shown = layout.tiles.length ? canvas?.getContext?.('2d') : null;
  if (!shown) {
    onState('failed');
    return { done: Promise.resolve(), destroy };
  }
  if (finished.has(canvas) && canvas.width > 0)
    back = canvas.ownerDocument.createElement('canvas');
  const target = back ?? canvas;
  const ctx = back ? back.getContext('2d') : shown;
  target.width = layout.width * scale;
  target.height = layout.height * scale;
  // Painted straight onto the canvas, this drawing's frame shows from now.
  if (!back) onFrame();
  const colours = cardMapColours(theme);
  ctx.fillStyle = colours.land;
  ctx.fillRect(0, 0, target.width, target.height);
  onState('loading');

  // Past the source's deepest zoom, each tile is drawn from the one over it.
  const zs = Math.min(zoom, CARD_MAP_SOURCE_MAXZOOM);
  const d = zoom - zs;
  const parentKey = (t) => `${zs}/${t.x >> d}/${t.y >> d}`;
  const parents = [
    ...new Map(
      layout.tiles.map((t) => [
        parentKey(t),
        { z: zs, x: t.x >> d, y: t.y >> d },
      ]),
    ).values(),
  ];
  const size = TILE * scale;
  let painting = Promise.resolve();
  let drawn = 0;
  const paint = (style, tile) => {
    painting = painting.then(async () => {
      if (signal.aborted) return;
      const view = kept.get(parentKey(tile));
      const url = `cardmap://tile/${zs}/${tile.x >> d}/${tile.y >> d}`;
      // The painter reads the tile it is given, synchronously, and keeps
      // no copy of it.
      style.tiles.set(url, Promise.resolve(view));
      let painted;
      try {
        painted = paintVectorTile(style, zoom, tile.x, tile.y, {
          size,
          signal,
          fetch: NO_FETCH,
          canvas: (side) => {
            scratch ??= canvas.ownerDocument.createElement('canvas');
            if (scratch.width !== side) scratch.width = scratch.height = side;
            return scratch;
          },
        });
      } finally {
        style.tiles.delete(url);
      }
      try {
        const out = await painted;
        if (signal.aborted) return;
        ctx.drawImage(
          out,
          (tile.left - layout.left) * scale,
          (tile.top - layout.top) * scale,
        );
        drawn += 1;
      } catch {
        // A tile that cannot be painted stays plain land.
      }
    });
  };

  const done = (async () => {
    try {
      const style = await compiledStyle(theme, scale);
      signal.throwIfAborted();
      await cardMapSource().fetchBounds(
        tileBox(parents[0].z, parents[0].x, parents[0].y),
        {
          zoom: zs,
          tiles: parents,
          signal,
          onTile: (value, parent) => {
            const key = `${parent.z}/${parent.x}/${parent.y}`;
            plain.set(key, value);
            kept.set(key, cardMapVectorTile(value));
            for (const tile of layout.tiles)
              if (parentKey(tile) === key) paint(style, tile);
          },
        },
      );
      await painting;
      if (signal.aborted) return;
      if (drawn)
        drawLabels(ctx, {
          layout,
          plain,
          d,
          scale,
          view,
          clearBottom,
          locale,
          colours,
        });
      if (back && !drawn) {
        // A redraw that drew nothing leaves the finished map's pixels as
        // they are, and says it failed (Play then waits its timeout).
        onState('failed');
        return;
      }
      if (back) {
        canvas.width = back.width;
        canvas.height = back.height;
        shown.drawImage(back, 0, 0);
        onFrame();
      }
      if (drawn) finished.add(canvas);
      else finished.delete(canvas);
      onState(drawn ? 'ready' : 'failed');
    } catch (error) {
      if (!signal.aborted && !isAbort(error)) onState('failed');
    } finally {
      free();
    }
  })();
  return { done, destroy };
}

/**
 * The names over a drawn map: each kept tile's grid placed on the map from
 * a tile drawn from it, then the names placed inside what shows.
 */
function drawLabels(
  ctx,
  { layout, plain, d, scale, view, clearBottom, locale, colours },
) {
  const span = TILE * 2 ** d;
  const tiles = [];
  for (const [key, kept] of plain) {
    const [, px, py] = key.split('/').map(Number);
    const child = layout.tiles.find((t) => t.x >> d === px && t.y >> d === py);
    if (!child) continue;
    const ox = child.left - layout.left - (child.x - (px << d)) * TILE;
    const oy = child.top - layout.top - (child.y - (py << d)) * TILE;
    const k = span / kept.extent;
    tiles.push({ kept, at: (x, y) => [ox + x * k, oy + y * k] });
  }
  // In map pixels: the spot is at (-left, -top).
  const sx = -layout.left;
  const sy = -layout.top;
  const shown = view || {
    left: layout.left,
    top: layout.top,
    width: layout.width,
    height: layout.height,
  };
  const left = Math.max(0, shown.left + sx);
  const top = Math.max(0, shown.top + sy);
  const right = Math.min(layout.width, shown.left + shown.width + sx);
  const bottom = Math.min(layout.height, shown.top + shown.height + sy);
  const m = CARD_MAP_LABELS.marker;
  placeLabels(ctx, collectLabels(tiles, { locale }), {
    bounds: [left, top, right, bottom],
    clear: [
      [sx - m, sy - m, sx + m, sy + m],
      ...(clearBottom > 0 ? [[left, bottom - clearBottom, right, bottom]] : []),
    ],
    scale,
    colours,
  });
}
