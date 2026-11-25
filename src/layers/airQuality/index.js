import { fromDegrees } from '../../geo/ellipsoid.js';
import { greatCircleKm } from '../../geoDistance.js';
import { cssColor } from '../../render/color.js';
import { drawOf, findCamera } from '../../render/rendererOf.js';
import { formatNumber, msg, t, tn } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import { formatQuantity } from '../../ui/unitLabels.js';
import {
  AIR_QUALITY_BANDS,
  airQualityBandById,
  airQualityColor,
  AIR_QUALITY_OVERLAY_SOURCE_ID,
  AIR_QUALITY_OVERLAY_COHORT_LIMIT,
  AIR_QUALITY_OVERLAY_COLLISION_CAPACITY,
  AIR_QUALITY_PROVIDERS,
  airQualityCovers,
  createAirQualityOverlayEntry,
  mapAnalystRecord,
  newestObservation,
  readingsAreStale,
  readingsInView,
  selectAirQualityOverlayCohort,
  valueLabel,
} from './model.js';
export * from './model.js';
export { createEcccAirQualitySource } from './source.js';

/** Station markers are a point reading, not an extent. */
const STATION_MARKER_RADIUS_M = 6_000;
/** Readings listed in the readout card. */
const READOUT_LIMIT = 5;
/** Farthest a station's reading stands for a point, in kilometres. */
export const AIR_QUALITY_VALUE_RADIUS_KM = 50;

export const AIR_QUALITY_MARKER_SET_ID = 'air-quality';
let instances = 0;

/** A reading's colour at `alpha`; an unreadable colour falls back to white. */
function withAlpha(css, alpha) {
  const [r, g, b] = cssColor(css) ?? [1, 1, 1];
  return [r, g, b, alpha];
}

/** Own one air-quality display, its refresh lifecycle, and its readout card. */
export function createAirQualityLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Air quality requires a snapshot source');
  if (!overlayHost) throw new TypeError('Air quality requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _markers = null;
  let _readings = [];
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  /** The camera's lon/lat rectangle in degrees, or null when unresolvable. */
  const viewRectangle = () =>
    _viewer ? (findCamera(_viewer)?.viewRectangle() ?? null) : null;

  const layer = {
    id: 'air-quality',
    name: 'Air quality',
    icon: '◍',
    source: 'ECCC MSC GeoMet',
    updateInterval: 1_200_000,

    init(viewer) {
      if (_viewer) throw new Error('Air quality layer is already initialized');
      _markers = drawOf(viewer).shapes({
        id: `${AIR_QUALITY_MARKER_SET_ID}:${++instances}`,
        show: false,
      });
      _viewer = viewer;
      _readings = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_markers) _markers.show = true;
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, true);
      notify();
    },

    disable() {
      // Abort in flight: a response arriving after disable must not redraw.
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_markers) _markers.show = false;
      overlayHost.clearSource(AIR_QUALITY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update() {
      if (!_enabled || !_markers) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const readings = await source.getSnapshot({ signal: request.signal });
        // A superseded or aborted request must not touch the scene, and neither
        // must one that lands after the layer was switched off.
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _readings = readings;
        this._render();
        _count = _readings.length;
        _lastUpdate = Date.now();
        _lastError = null;
        notify();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Air quality request failed');
        console.warn('[Data:AirQuality] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    /** Redraw the station markers and overlay labels from the current readings. */
    _render() {
      if (!_markers) return;
      const markers = [];
      const overlayEntries = [];
      for (const reading of _readings) {
        const position = fromDegrees(reading.lon, reading.lat);
        // A filled disc on the ground with static axes, as in the earthquake
        // layer: a per-frame axis re-tessellates clamped ground geometry
        // every frame. No outline: clamped to the ground, the default
        // renderer never drew one.
        markers.push({
          id: `air-quality:${reading.id}`,
          geometry: {
            kind: 'ellipse',
            center: { lon: reading.lon, lat: reading.lat },
            semiMajor: STATION_MARKER_RADIUS_M,
            semiMinor: STATION_MARKER_RADIUS_M,
          },
          fill: withAlpha(reading.color, 0.35),
          height: 'clampGround',
          clampTo: 'both',
          meta: {
            provider: reading.provider,
            scale: reading.scale,
            value: reading.value,
            band: reading.band,
            name: reading.name,
            zone: reading.zone,
            risk: reading.risk,
            observedMs: reading.observedMs,
            note: reading.note,
            lat: reading.lat,
            lon: reading.lon,
          },
        });
        overlayEntries.push(
          createAirQualityOverlayEntry({
            id: reading.id,
            position,
            title: `${reading.name} ${reading.label}`,
            accent: reading.color,
            value: reading.value,
          }),
        );
      }
      _markers.set(markers);
      if (_enabled) {
        overlayHost.setEntries(
          AIR_QUALITY_OVERLAY_SOURCE_ID,
          selectAirQualityOverlayCohort(overlayEntries),
          {
            cohortLimit: AIR_QUALITY_OVERLAY_COHORT_LIMIT,
            collisionCapacity: AIR_QUALITY_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
      }
    },

    destroy() {
      _request?.abort();
      _request = null;
      _enabled = false;
      overlayHost.clearSource(AIR_QUALITY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, false);
      _markers?.dispose();
      _markers = null;
      _viewer = null;
      _readings = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      rowControlsListener = null;
    },

    /**
     * Readout descriptor for the Weather panel: the band legend, and the worst
     * readings currently in view.
     *
     * `readout: true` renders the toggle and source line only; the card owns
     * the rest. Coverage is stated plainly because this layer is not global.
     */
    getRowControls() {
      const provider = AIR_QUALITY_PROVIDERS.eccc;
      const inView = layer.getHighestReadings(READOUT_LIMIT);
      const newest = _readings.reduce(
        (max, reading) => Math.max(max, reading.observedMs || 0),
        0,
      );
      // Readings and errors stay English data (analyst records, stats); the
      // card translates them as the Layers panel row does. A provider's own
      // error text has no catalog entry and shows as it came.
      return {
        readout: true,
        summary: {
          label: t(provider.label),
          coverage: t(provider.coverage),
          validTime: newest ? new Date(newest).toISOString() : undefined,
          detail: `${provider.network} · ${provider.scale}`,
          status: _lastError
            ? translateFeedError(_lastError)
            : _count === 0
              ? _lastUpdate === null
                ? t('No readings available')
                : t('No current readings')
              : tn(
                  _count,
                  '{count} station reporting',
                  '{count} stations reporting',
                ),
          units: provider.scale,
        },
        legend: AIR_QUALITY_BANDS.map((band) => ({
          color: band.color,
          label: t(band.label),
        })),
        legendCategorical: true,
        list: {
          ariaLabel: t('Highest air-quality readings in view'),
          items: inView.map((reading, index) => ({
            id: reading.id,
            ordinal: index + 1,
            lead: reading.lead,
            text: `${reading.name} · ${reading.risk}`,
            accent: reading.color,
          })),
        },
      };
    },

    /**
     * The worst readings in the camera's view, worst first (the Weather
     * card's list): `{id, name, lat, lon, lead: "AQHI 4", band, color, risk,
     * record}`, `band` the legend band (`{id, label, color}`) or null and
     * `record` the station's analyst record. Empty while off.
     */
    getHighestReadings(limit = READOUT_LIMIT) {
      if (!_enabled) return [];
      return readingsInView(_readings, viewRectangle(), limit).map(
        (reading, index) => {
          const band = airQualityBandById(reading.band);
          return {
            id: reading.id,
            name: reading.name,
            lat: reading.lat,
            lon: reading.lon,
            lead: `${reading.scale} ${reading.label}`,
            band: band
              ? { id: band.id, label: t(band.label), color: band.color }
              : null,
            color: reading.color,
            risk: t(reading.risk),
            record: mapAnalystRecord(reading, index),
          };
        },
      );
    },

    /**
     * Stations reporting per legend band, in legend order:
     * `{id, label, color, count}`, `label` English (as the legend's). Empty
     * while off or with nothing loaded.
     */
    getBandCounts() {
      if (!_enabled || !_readings.length) return [];
      return AIR_QUALITY_BANDS.map((band) => ({
        id: band.id,
        label: band.label,
        color: band.color,
        count: _readings.filter((reading) => reading.band === band.id).length,
      }));
    },

    /**
     * What Context shows of the layer: stations reporting by band, the
     * worst readings in view (each with the station's analyst record, to
     * open its card), and the network's coverage. Null while off.
     */
    getContextSummary(limit = READOUT_LIMIT) {
      if (!_enabled) return null;
      return {
        caption: _count
          ? tn(
              _count,
              '{count} station reporting',
              '{count} stations reporting',
            )
          : '',
        bands: layer.getBandCounts(),
        itemsLabel: t('Highest air-quality readings in view'),
        items: layer.getHighestReadings(limit).map((reading) => ({
          key: reading.id,
          lead: reading.lead,
          level: reading.band?.id,
          color: reading.color,
          text: [reading.name, reading.band?.label].filter(Boolean).join(' · '),
          title: `${reading.lead} · ${reading.name} · ${reading.risk}`,
          lat: reading.lat,
          lon: reading.lon,
          record: reading.record,
        })),
        note: t(AIR_QUALITY_PROVIDERS.eccc.coverage),
      };
    },

    /**
     * A station's reading for its card: the value on its scale, its legend
     * band and health message, and the scale's bands as segments (`share` of
     * the scale) with the value's place on it (`at`, 0 to 1). Null for a
     * record with no reading.
     * @param {object} record An analyst record of this layer.
     */
    describeReading(record) {
      const provider = AIR_QUALITY_PROVIDERS[record?.provider];
      if (!provider || !Number.isFinite(record?.value)) return null;
      const band = airQualityBandById(record.band);
      // Each band's span on the published scale; the open top band is one step.
      const top = provider.bands.at(-2)?.max ?? record.value;
      let from = 0;
      const segments = provider.bands.map((step) => {
        const to = Number.isFinite(step.max) ? step.max : top + 1;
        const legend = airQualityBandById(step.id);
        const segment = {
          id: step.id,
          label: t(legend?.label ?? step.id),
          color: airQualityColor(step.id),
          share: (to - from) / (top + 1),
        };
        from = to;
        return segment;
      });
      return {
        scale: provider.scale,
        value: valueLabel(provider.id, record.value),
        band: band
          ? { id: band.id, label: t(band.label), color: band.color }
          : null,
        risk: band ? t(band.risk) : '',
        at: Math.min(1, Math.max(0, (record.value - 0.5) / (top + 1))),
        segments,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot readings as JSON-safe records for the analyst query engine.
     * @param {number} [maxCount=500]
     * @returns {Array<object>}
     */
    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_readings.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return _readings
        .slice(0, limit)
        .map((reading, index) => mapAnalystRecord(reading, index));
    },

    /**
     * The nearest station's reading to a point, from the readings already
     * loaded: `{value: "AQHI 3 · Low", detail: "Toronto · 4 km", at, level,
     * color}`, the band and its colour when known. Returns
     * null while off, for invalid coordinates, or while awaiting readings inside coverage. Returns
     * `{value: null, reason}` when no station is within AIR_QUALITY_VALUE_RADIUS_KM,
     * with `outsideCoverage: true` when the point is outside every provider's
     * coverage area as well.
     */
    getValueAt(lat, lon) {
      if (!_enabled || !Number.isFinite(lat) || !Number.isFinite(lon))
        return null;
      if (!_readings.length && airQualityCovers(lat, lon)) return null;
      let nearest = null;
      let nearestKm = Infinity;
      for (const reading of _readings) {
        if (!Number.isFinite(reading?.lat) || !Number.isFinite(reading?.lon))
          continue;
        const km = greatCircleKm({ lat, lon }, reading);
        if (km < nearestKm) {
          nearest = reading;
          nearestKm = km;
        }
      }
      if (!nearest || nearestKm > AIR_QUALITY_VALUE_RADIUS_KM)
        return {
          value: null,
          reason: t('No station within {n} km', {
            n: formatNumber(AIR_QUALITY_VALUE_RADIUS_KM),
          }),
          ...(airQualityCovers(lat, lon) ? {} : { outsideCoverage: true }),
        };
      const band = airQualityBandById(nearest.band);
      const shown = `${nearest.scale} ${nearest.label ?? nearest.value}`;
      return {
        value: band ? `${shown} · ${t(band.label)}` : shown,
        detail: `${nearest.name} · ${formatQuantity(Math.round(nearestKm), 'km')}`,
        // The band and its map colour, so a reading can match the map.
        ...(band ? { level: band.id, color: band.color } : {}),
        ...(Number.isFinite(nearest.observedMs)
          ? { at: nearest.observedMs }
          : {}),
      };
    },

    getStats() {
      // `lastUpdate` is when a response was received; `observedAt` is when the
      // network actually measured. Freshness is judged on the latter, so a feed
      // that keeps answering with hours-old observations reports STALE rather
      // than being narrated as live by the HUD and voice provenance envelope.
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        observedAt: newestObservation(_readings),
        // Only a completed refresh can be stale; before one there is no feed.
        stale: _lastUpdate !== null && readingsAreStale(_readings),
      };
    },
  };
  return layer;
}
