import { h, render as renderVue } from 'vue';
import { formatUtcDayMonth, t } from '../i18n/index.js';
import { utcClock } from './rail/utcClock.js';
import WeatherReadout from './weather/WeatherReadout.vue';
import { setContextListPresence } from './contextLists.js';

// Remounting controls must not reopen a panel the user already collapsed.
// Keyed by the page's Weather panel, which outlives remounted controls.
const appearedPanels = new WeakSet();
const ORDER = [
  'weather-cyclones',
  'wind',
  'weather-radar',
  'weather-satellite',
  'weather-lightning',
  'air-quality',
];
const OBSERVED = new Set(ORDER.slice(2, 5));
const utc = (time) =>
  Number.isFinite(Date.parse(time))
    ? `${formatUtcDayMonth(time)} ${utcClock(time)}`
    : t('Unavailable');
const clockTime = (time) => utcClock(time) || t('Unavailable');
// Ages are measured from `nowMs`: the world clock's time at a past time, the
// wall clock while live.
const minutesBefore = (time, nowMs = Date.now()) =>
  Math.max(0, Math.floor((nowMs - Date.parse(time)) / 60_000));
const age = (time, nowMs) => {
  const minutes = minutesBefore(time, nowMs);
  return minutes >= 60
    ? t('{hours}h {minutes}m ago', {
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
      })
    : t('{minutes}m ago', { minutes });
};
// A frame's time on the timeline: its age while live; at a past time, the
// clock time alone, as the timeline time is the one it is measured from.
const historyTime = (time, state) =>
  state?.mode === 'history'
    ? clockTime(time)
    : t('{time} · {minutes} min ago', {
        time: clockTime(time),
        minutes: minutesBefore(time),
      });
const dated = (time, nowMs) => `${utc(time)} · ${age(time, nowMs)}`;
/** The time the observed products show: the timeline time, or now while live. */
const shownNow = (state) =>
  state?.mode === 'history' && Number.isFinite(Date.parse(state.target))
    ? Date.parse(state.target)
    : Date.now();
const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};
const OBSERVED_NAMES = {
  'weather-radar': () => t('Rain radar'),
  'weather-satellite': () => t('Satellite clouds'),
  'weather-lightning': () => t('Lightning density'),
};
/** A layer's legend as a rail-card block, or null without one. */
function legendBlockOf({ legend = [], legendCategorical, summary }) {
  if (!legend.length) return null;
  // Discrete classes (storm geometry, AQHI bands) list swatches, not a ramp.
  const categorical = legendCategorical === true;
  return {
    id: 'legend',
    type: 'legend',
    legend: {
      categorical,
      colors: legend.map(({ color }) => color),
      labels: legend.map(({ label }) => label),
      units: categorical ? '' : summary.units,
      ...(summary.unitsVerbatim === true ? { unitsVerbatim: true } : {}),
      zeroIndex: legend.findIndex(({ label }) => label === '0'),
    },
  };
}
/**
 * An observed product's briefing lines: its name and the age of the frame it
 * shows while live, or the frame's clock time at a past time, then its
 * status; without a frame, its status takes the place of the time.
 */
function observedLines(entry, state) {
  const name = OBSERVED_NAMES[entry.id]();
  const { status } = entry.summary;
  const product = state.products?.find((item) => item.id === entry.id);
  const shown = product?.shown ?? entry.summary.shownTime;
  let time = null;
  if (state.mode === 'history' && product?.selected === null)
    time = t('No frame at this time');
  else if (Number.isFinite(Date.parse(shown)))
    time =
      state.mode === 'history'
        ? clockTime(shown)
        : minutesBefore(shown) >= 60
          ? age(shown)
          : t('{n} min ago', { n: minutesBefore(shown) });
  if (!time)
    return [
      {
        id: entry.id,
        text: `${name} · ${status || t('Waiting for observation')}`,
      },
    ];
  return [
    { id: entry.id, text: `${name} · ${time}` },
    ...(status
      ? [{ id: `${entry.id}-status`, text: status, muted: true }]
      : []),
  ];
}

/**
 * Weather's briefing, in reading order: conditions at the map center, the
 * observed frames with the radar legend, the wind forecast, then storm
 * alerts. A section shows only while a layer behind it is on, and each line
 * is a plain status rather than an empty value. `layerId` is the layer its
 * controls act on.
 * @param {object[]} active The weather entries that show, with summaries.
 * @param {object} state The weather clock's state.
 * @param {{follows?: (id: string) => boolean}} [clock]
 * @returns {{id: string, title: string, layerId: string, blocks: object[]}[]}
 */
export function weatherBriefing(active, state, clock) {
  const byId = new Map(active.map((entry) => [entry.id, entry]));
  const sections = [];
  const wind = byId.get('wind');
  if (wind) {
    // The wind layer reads the forecast at the map center on request:
    // temperature or pressure with the field shown, then the wind itself.
    const result = wind.summary.result;
    const lines = ['scalar', 'wind']
      .map((id) => result?.lines?.find((line) => line.id === id))
      .filter((line) => line?.text);
    const read = wind.summary.actions?.find(({ id }) => id === 'read-wind');
    sections.push({
      id: 'here',
      title: lines.length && result.label ? result.label : t('At map center'),
      layerId: 'wind',
      blocks: lines.length
        ? [{ id: 'reading', type: 'lines', lines }]
        : read
          ? [{ id: 'read', type: 'actions', actions: [read] }]
          : [],
    });
  }
  const observed = ORDER.filter((id) => OBSERVED.has(id) && byId.has(id)).map(
    (id) => byId.get(id),
  );
  if (observed.length) {
    const blocks = [];
    for (const entry of observed) {
      blocks.push({
        id: entry.id,
        type: 'lines',
        lines: observedLines(entry, state),
      });
      const legend = entry.id === 'weather-radar' && legendBlockOf(entry);
      if (legend) blocks.push(legend);
    }
    sections.push({
      id: 'observed',
      title: t('Observed'),
      layerId: observed[0].id,
      blocks,
    });
  }
  if (wind) {
    const { summary } = wind;
    const valid = Number.isFinite(Date.parse(summary.validTime));
    const lines = [
      {
        id: 'valid',
        text: valid
          ? t('Forecast · valid {valid}', { valid: utc(summary.validTime) })
          : summary.status || t('Loading forecast'),
      },
    ];
    if (valid && summary.status)
      lines.push({ id: 'status', text: summary.status, muted: true });
    if (state.mode === 'history' && !clock?.follows?.('wind'))
      lines.push({
        id: 'history',
        text: t('Forecast · does not follow history'),
        muted: true,
      });
    sections.push({
      id: 'wind',
      title: t('Wind'),
      layerId: 'wind',
      blocks: [{ id: 'forecast', type: 'lines', lines }],
    });
  }
  const storms = byId.get('weather-cyclones');
  if (storms) {
    const { summary, list } = storms;
    const lines = [];
    if (!list?.items?.length && summary.detail)
      lines.push({ id: 'detail', text: summary.detail });
    if (summary.status)
      lines.push({ id: 'status', text: summary.status, muted: true });
    sections.push({
      id: 'alerts',
      title: t('Alerts'),
      layerId: 'weather-cyclones',
      blocks: [
        ...(list?.items?.length ? [{ id: 'list', type: 'list', list }] : []),
        ...(lines.length ? [{ id: 'lines', type: 'lines', lines }] : []),
      ],
    });
  }
  return sections.filter(({ blocks }) => blocks.length);
}

/**
 * Map weather descriptors and the observed clock into reusable rail readouts.
 * It also reports through `onPresence` whether a weather layer is on, and how
 * many products show, so Context shows Weather's list tab only then.
 */
export function createWeatherPanel({
  container,
  clock,
  setLayerParams = () => {},
  onAction = () => {},
  onPresence = (state) => setContextListPresence('weather', state),
} = {}) {
  const document = container?.ownerDocument;
  if (!document?.createElement) return null;
  const panel = container.closest?.('#weather-panel');
  const count = panel?.querySelector('#weather-panel-count');
  let entries = [];
  let destroyed = false;
  // The product whose details show, or null for the list.
  let selected = null;
  const handlers = {
    onParams: (id, params) => setLayerParams(id, params, { origin: 'user' }),
    onSelect: (id) => {
      selected = id;
      render();
    },
  };
  const paint = (view) =>
    renderVue(h(WeatherReadout, { view, selected, ...handlers }), container);
  const render = () => {
    if (destroyed) return;
    const state = clock?.getState() || {
      mode: 'latest',
      timeline: [],
      products: [],
    };
    const active = entries
      .filter(({ summary }) => summary)
      .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    const showObserved = active.some(({ id }) => OBSERVED.has(id));
    // While live, the newest frame and its age; at a past time, the timeline
    // time alone. The world timeline moves the time. Live, each product's
    // newest frame counts, suspended or not (reduced motion, a hidden page),
    // as the timeline leaves those out.
    const newest = () => {
      const times = (state.products ?? [])
        .map(({ selected }) => selected)
        .filter((time) => Number.isFinite(Date.parse(time)))
        .sort((a, b) => Date.parse(a) - Date.parse(b));
      return times.at(-1) ?? state.timeline.at(-1);
    };
    const shownTime = state.mode === 'latest' ? newest() : state.target;
    const frameTime =
      showObserved && shownTime
        ? state.mode === 'history'
          ? clockTime(shownTime)
          : historyTime(shownTime)
        : '';
    const models = active.map((entry) => {
      const { id, icon, summary, list } = entry;
      let detail = summary.detail;
      const product = state.products.find((item) => item.id === id);
      if (OBSERVED.has(id)) {
        const shown = product?.shown ?? summary.shownTime;
        if (state.mode === 'history' && product?.selected === null) {
          const gap = summary.maxGapMinutes || 30;
          const time = clockTime(state.target);
          detail =
            gap < 60
              ? t('No frame within {gap} min of {time}', { gap, time })
              : t('No frame within {gap} h of {time}', { gap: gap / 60, time });
        } else if (shown) {
          detail = dated(shown, shownNow(state));
          if (state.mode === 'history')
            detail =
              Date.parse(shown) === Date.parse(state.target)
                ? t('{detail} · synced', { detail })
                : t('{detail} · nearest', { detail });
        }
      } else if (id === 'wind') {
        detail = t('Forecast · valid {valid} · issued {issued}', {
          valid: utc(summary.validTime),
          issued: utc(summary.issuedTime),
        });
        // Unless its source follows the timeline, wind stays at the live edge.
        if (state.mode === 'history' && !clock?.follows?.(id))
          detail = t('{detail} · Does not follow history', { detail });
      }
      const lines = [
        { id: 'time', text: detail, muted: true },
        { id: 'status', text: summary.status },
      ];
      for (const line of summary.lines || []) lines.push(line);
      const actions = (summary.actions || []).map((action) => ({
        ...action,
        onClick: action.onClick || (() => onAction(id, action.id)),
      }));
      const legendBlock = legendBlockOf(entry);
      const blocks = [
        ...(list?.items?.length ? [{ id: 'list', type: 'list', list }] : []),
        { id: 'details', type: 'lines', lines },
        ...(legendBlock ? [legendBlock] : []),
        ...(summary.settings?.length
          ? [{ id: 'settings', type: 'settings', settings: summary.settings }]
          : []),
        ...(actions.length
          ? [{ id: 'actions', type: 'actions', actions }]
          : []),
        ...(summary.result ? [{ ...summary.result, type: 'result' }] : []),
      ];
      return {
        id,
        icon,
        title: summary.label,
        badge: summary.coverage,
        compact:
          summary.status ||
          summary.compact ||
          (id === 'wind'
            ? t('Forecast · valid {valid}', { valid: utc(summary.validTime) })
            : detail),
        compactStatus: Boolean(summary.status),
        blocks,
      };
    });
    const hidden = active.length === 0;
    if (!active.some(({ id }) => id === selected)) selected = null;
    paint({
      hidden,
      briefing: weatherBriefing(active, state, clock),
      frameTime,
      cards: models,
    });
    if (count) set(count, 'textContent', String(active.length));
    if (panel) set(panel, 'hidden', hidden);
    if (!hidden && panel && !appearedPanels.has(panel)) {
      appearedPanels.add(panel);
      // First appearance opens the panel unless a stored or shared collapse
      // choice exists (marked by the panel chrome when it restored the state).
      const preference = panel.dataset?.collapsedPreference;
      if (
        panel.classList.contains('collapsed') &&
        (preference === undefined || preference === 'default')
      )
        panel.querySelector('[data-collapse-target="weather-panel"]')?.click();
    }
    onPresence(hidden ? null : { count: active.length });
  };
  const unsubscribe = clock?.subscribe(render);
  return {
    update(nextEntries) {
      entries = nextEntries.filter(({ summary }) => summary);
      render();
    },
    destroy() {
      destroyed = true;
      unsubscribe?.();
      renderVue(null, container);
      if (panel) set(panel, 'hidden', true);
      if (count) set(count, 'textContent', '0');
      onPresence(null);
    },
  };
}
