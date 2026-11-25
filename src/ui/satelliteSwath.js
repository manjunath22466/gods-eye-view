// The swath a satellite's card lists items inside: the ground it sees right
// now. An Earth-observation satellite whose imaging sensor is in the bundled
// pack uses that sensor's widest standard swath; any other uses the ground it
// sees above 45° elevation, the cone straight down that stays well clear of
// the horizon.

const EARTH_RADIUS_KM = 6371;
/** The lowest elevation, seen from the ground, counted as "under" it. */
const MIN_ELEVATION_DEG = 45;

/**
 * Width of the ground under a satellite seen above `minElevationDeg`, in km.
 * @param {number} altitudeM
 * @param {number} [minElevationDeg]
 * @returns {?number}
 */
export function visibleSwathKm(altitudeM, minElevationDeg = MIN_ELEVATION_DEG) {
  const h = altitudeM / 1000;
  if (!Number.isFinite(h) || h <= 0) return null;
  const e = (minElevationDeg * Math.PI) / 180;
  const centralAngle =
    Math.acos((EARTH_RADIUS_KM * Math.cos(e)) / (EARTH_RADIUS_KM + h)) - e;
  return Math.max(0, 2 * centralAngle * EARTH_RADIUS_KM);
}

/**
 * A satellite's swath width, and what it comes from.
 * @param {{sensor?: ?{label?: ?string, swathKm?: ?number}}|null} described
 * @param {number} altitudeM
 * @returns {?{km: number, sensor: ?string}}
 */
export function satelliteSwath(described, altitudeM) {
  const sensorKm = described?.sensor?.swathKm;
  if (Number.isFinite(sensorKm) && sensorKm > 0)
    return { km: sensorKm, sensor: described.sensor.label || null };
  const km = visibleSwathKm(altitudeM);
  return km ? { km, sensor: null } : null;
}

/** Ground metres per tile pixel at zoom 0 on the equator (Web Mercator). */
const METRES_PER_PIXEL_Z0 = 156_543.03;
const TILE_PX = 256;
/** How much of the ground view's width the swath circle takes. */
export const SWATH_SHARE = 0.45;
/** The ground view's width before it has been laid out. */
export const GROUND_VIEW_WIDTH_PX = 340;
/** The tile zooms the ground view draws from. */
export const GROUND_ZOOM = Object.freeze({ min: 2, max: 13 });

/**
 * A swath's width on a map of tiles at `zoom` drawn at `scale`, in pixels.
 * @param {number} lat
 * @param {number} swathKm
 * @param {number} zoom
 * @param {number} [scale]
 * @returns {number}
 */
export function swathPixels(lat, swathKm, zoom, scale = 1) {
  if (!Number.isFinite(lat) || !Number.isFinite(swathKm) || swathKm <= 0)
    return 0;
  const cosLat = Math.cos((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (
    ((swathKm * 1000 * 2 ** zoom) / (METRES_PER_PIXEL_Z0 * cosLat)) * scale
  );
}

/**
 * How the ground view frames a swath: the tile zoom it reads, the scale it
 * draws those tiles at, and the swath circle's diameter in screen pixels.
 * The swath takes about `share` of the view's width, with coast and
 * places round it. Tiles and circle share one scale, so the circle stays
 * true to the ground. The zoom is the closest whose 3 by 3 tile block,
 * once scaled, still covers the whole width; a swath too wide for that
 * even at the widest zoom takes more of the view.
 * @param {number} lat
 * @param {number} swathKm
 * @param {number} [widthPx] The view's width.
 * @param {number} [share]
 * @returns {?{zoom: number, scale: number, swathPx: number}}
 */
export function groundFrame(
  lat,
  swathKm,
  widthPx = GROUND_VIEW_WIDTH_PX,
  share = SWATH_SHARE,
) {
  if (!Number.isFinite(lat) || !Number.isFinite(swathKm) || swathKm <= 0)
    return null;
  const width =
    Number.isFinite(widthPx) && widthPx > 0 ? widthPx : GROUND_VIEW_WIDTH_PX;
  const swathPxAt = (zoom) => swathPixels(lat, swathKm, zoom);
  const target = share * width;
  let zoom = Math.ceil(Math.log2(target / swathPxAt(0)));
  zoom = Math.max(GROUND_ZOOM.min, Math.min(GROUND_ZOOM.max, zoom));
  let scale = target / swathPxAt(zoom);
  // The block reaches at least one scaled tile past the spot on every side.
  const reach = width / 2 + 1;
  while (TILE_PX * scale < reach && zoom > GROUND_ZOOM.min) {
    zoom -= 1;
    scale *= 2;
  }
  scale = Math.max(scale, reach / TILE_PX);
  return { zoom, scale, swathPx: swathPxAt(zoom) * scale };
}
