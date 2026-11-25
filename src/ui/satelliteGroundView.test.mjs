// A satellite's card: the ground view under it frames the swath at a little
// under half its width, true to scale, with Esri's place names round it, a
// faint swath circle and a credit naming every source; the hero keeps its own height;
// the orbit class and inclination are tiles of their own. Over happy-dom;
// the stylesheet is checked where layout matters.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp, h, nextTick, reactive } from 'vue';
import { createPinia } from 'pinia';
import {
  GROUND_VIEW_WIDTH_PX,
  GROUND_ZOOM,
  SWATH_SHARE,
  groundFrame,
  swathPixels,
} from './satelliteSwath.js';
import {
  ESRI_IMAGERY_PLACES_CARD_CREDIT,
  ESRI_IMAGERY_PLACES_CREDIT,
  ESRI_PLACES_TILES,
} from '../maps/attribution.js';
import SatelliteGroundView from './views/panels/SatelliteGroundView.vue';
import ContextView from './views/ContextView.vue';
import { useEntityCardStore } from './stores/entityCard.js';
import { usePanelChromeStore } from './stores/panelChrome.js';

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = withoutComments(
  fs.readFileSync(new URL('./styles/entity-card.css', import.meta.url), 'utf8'),
);
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1];
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
/** A style length in pixels is the given size, to a thousandth of a pixel. */
const assertPx = (length, px) =>
  assert.ok(Math.abs(parseFloat(length) - px) < 1e-3, `${length} vs ${px}`);
const METRES_PER_PIXEL_Z0 = 156_543.03;

test('the swath takes 40 to 50% of the width, from a narrow sensor to a wide one, anywhere', () => {
  for (const width of [280, GROUND_VIEW_WIDTH_PX, 420])
    for (const lat of [0, 30, -45, 60, 75])
      for (const swathKm of [5, 13, 60, 185, 290, 700, 1000, 2330, 3000]) {
        const frame = groundFrame(lat, swathKm, width);
        const share = frame.swathPx / width;
        const at = `${swathKm} km at ${lat}° in ${width} px`;
        // Far north or south the map stretches a very wide swath past what
        // the widest zoom can frame; it then takes more of the view.
        if (frame.zoom === GROUND_ZOOM.min && share > 0.5)
          assert.ok(Math.abs(lat) >= 70 && swathKm >= 3000, `${at}: ${share}`);
        else assert.ok(share >= 0.4 && share <= 0.5, `${at}: ${share}`);
        assert.ok(Number.isInteger(frame.zoom), at);
        assert.ok(
          frame.zoom >= GROUND_ZOOM.min && frame.zoom <= GROUND_ZOOM.max,
          at,
        );
        // The scaled 3 by 3 block reaches past both edges.
        assert.ok(256 * frame.scale >= width / 2, `${at}: ${frame.scale}`);
        // Tiles are never shrunk below half or stretched past twice.
        assert.ok(
          frame.scale > 0.5 && frame.scale <= 2,
          `${at}: ${frame.scale}`,
        );
      }
  assert.equal(SWATH_SHARE, 0.45);
});

test('the swath stays true to the ground: its circle and the tiles share one scale', () => {
  for (const [lat, swathKm] of [
    [0, 290],
    [52, 185],
    [-70, 2330],
    [10, 11000],
  ]) {
    const frame = groundFrame(lat, swathKm, 360);
    const metresPerPixel =
      (METRES_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180)) /
      2 ** frame.zoom /
      frame.scale;
    assert.ok(
      Math.abs((frame.swathPx * metresPerPixel) / 1000 - swathKm) < 1e-6,
      `${swathKm} km at ${lat}°`,
    );
  }
  // Wider swaths stand further back.
  const zooms = [5, 50, 500, 3000].map((km) => groundFrame(20, km).zoom);
  assert.deepEqual(
    zooms,
    [...zooms].sort((a, b) => b - a),
  );
  // A swath too wide for the widest zoom still fills the view with tiles.
  const huge = groundFrame(0, 11000, 360);
  assert.equal(huge.zoom, GROUND_ZOOM.min);
  assert.ok(256 * huge.scale >= 180);
  // Before layout the usual width is used; no swath, no frame.
  assert.deepEqual(groundFrame(10, 290, 0), groundFrame(10, 290));
  assert.equal(groundFrame(10, 0), null);
  assert.equal(groundFrame(Number.NaN, 290), null);
});

function mount(t, props, shown = null) {
  const realFetch = globalThis.fetch;
  // The cities pack stays off the network.
  globalThis.fetch = async () => new Response('', { status: 503 });
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const live = shown || props;
  const app = createApp({ render: () => h(SatelliteGroundView, { ...live }) });
  app.mount(host);
  t.after(() => {
    app.unmount();
    globalThis.fetch = realFetch;
  });
  return (selector) => [...host.querySelectorAll(selector)];
}

test('the view draws the framed zoom and scale, with place names over the imagery and a short credit', async (t) => {
  const $$ = mount(t, { lat: 48.85, lon: 2.35, active: true, swathKm: 290 });
  await turn();
  await nextTick();
  const frame = groundFrame(48.85, 290);
  const tiles = $$(
    '.satellite-ground__tile:not(.satellite-ground__tile--labels)',
  );
  const labels = $$('.satellite-ground__tile--labels');
  assert.equal(tiles.length, 9);
  assert.equal(labels.length, 9);
  for (const img of tiles)
    assert.match(
      img.getAttribute('src'),
      new RegExp(`World_Imagery/MapServer/tile/${frame.zoom}/`),
    );
  for (const img of labels)
    assert.ok(
      img
        .getAttribute('src')
        .startsWith(ESRI_PLACES_TILES.split('{z}')[0] + frame.zoom + '/'),
    );
  const images = $$('.satellite-ground__tile');
  assert.ok(
    images.indexOf(labels[0]) > images.indexOf(tiles.at(-1)),
    'names drawn over the imagery',
  );
  const [scale] = $$('.satellite-ground__scale');
  assert.equal(scale.style.transform, `scale(${frame.scale})`);
  const [swath] = $$('.satellite-ground__swath');
  assertPx(swath.style.width, frame.swathPx);
  assertPx(swath.style.height, frame.swathPx);
  const [credit] = $$('.satellite-ground__credit');
  assert.equal(credit.textContent, ESRI_IMAGERY_PLACES_CARD_CREDIT);
  for (const source of [
    'Maxar',
    'Earthstar Geographics',
    'HERE',
    'Garmin',
    '© OpenStreetMap contributors',
  ])
    assert.ok(
      credit.textContent.includes(source),
      `${source} is credited on screen`,
    );
  assert.equal(credit.getAttribute('title'), ESRI_IMAGERY_PLACES_CREDIT);
  assert.ok(
    credit.classList.contains('map-credit'),
    'the card maps’ shared credit',
  );
  assert.equal(
    credit.closest('[aria-hidden="true"]'),
    null,
    'the picture is hidden from screen readers, its credit is not',
  );
});

test('a swath known only after the still was taken reframes it; a changing swath resizes the circle', async (t) => {
  const props = reactive({
    lat: -33.87,
    lon: 151.21,
    active: true,
    swathKm: null,
  });
  const $$ = mount(t, props);
  await turn();
  await nextTick();
  assert.equal($$('.satellite-ground__swath').length, 0);
  assert.equal($$('.satellite-ground__rings').length, 1);
  props.swathKm = 760;
  await nextTick();
  await turn();
  await nextTick();
  const frame = groundFrame(-33.87, 760);
  const [swath] = $$('.satellite-ground__swath');
  assertPx(swath.style.width, frame.swathPx);
  assert.match(
    $$('.satellite-ground__tile')[0].getAttribute('src'),
    new RegExp(`/tile/${frame.zoom}/`),
  );
  // The height changes a little: the circle follows at the same zoom.
  props.swathKm = 780;
  await nextTick();
  assertPx(
    $$('.satellite-ground__swath')[0].style.width,
    swathPixels(-33.87, 780, frame.zoom, frame.scale),
  );
});

test('the swath is a faint hairline circle: no glow, the barest tint, no crosshair', () => {
  const swath = rule('.satellite-ground__swath');
  assert.ok(swath, 'the swath rule is present');
  const border = swath.match(
    /border:\s*1px solid rgba\(54, 220, 255, ([\d.]+)\)/,
  );
  assert.ok(border, 'a 1 px accent stroke');
  assert.ok(Number(border[1]) >= 0.25 && Number(border[1]) <= 0.35, border[1]);
  const fill = swath.match(/background:\s*rgba\(54, 220, 255, ([\d.]+)\)/);
  assert.ok(!fill || Number(fill[1]) <= 0.08, fill?.[1]);
  assert.doesNotMatch(swath, /box-shadow|filter/);
  assert.doesNotMatch(css, /\.satellite-ground__swath::(before|after)/);
  // The HUD's centre ring and its ticks stay off the ground view.
  assert.match(
    rule('.preview-hud--ground .preview-hud__ring') || '',
    /display:\s*none/,
  );
});

test('the credit is the card maps’ shared credit, not the cockpit’s', () => {
  assert.equal(
    rule('.satellite-ground__credit'),
    undefined,
    'no rules of its own',
  );
  assert.match(rule('.map-foot') || '', /\bbottom:/);
  assert.match(rule('.map-credit') || '', /background:/);
  assert.doesNotMatch(
    css,
    /\.satellite-ground__credit\s*,/,
    'not sharing the cockpit credit’s two-line rules',
  );
});

test('the satellite hero has a height of its own that layout cannot shrink', () => {
  const hero = rule(".entity-hero[data-hero='satellite']");
  assert.ok(hero, 'its own rule');
  assert.match(hero, /\bheight:\s*\d+px/);
  assert.match(hero, /\bmin-height:\s*\d+px/);
  assert.match(hero, /\bflex:\s*none/);
  assert.match(hero, /\bmargin-bottom:/);
  // It comes after the shared hero height rule, so it wins.
  assert.ok(
    css.indexOf(".entity-hero[data-hero='satellite'] {") >
      css.indexOf('.entity-hero:is('),
  );
});

test('a satellite card shows its orbit class and inclination as tiles of their own', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const app = createApp(ContextView).use(pinia);
  app.mount(host);
  const cards = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  const record = {
    noradId: '39084',
    name: 'LANDSAT 8',
    lat: 48.85,
    lon: 2.35,
    altitudeM: 705_000,
    speedMps: 7500,
  };
  const layer = {
    id: 'satellites',
    name: 'Satellites',
    enabled: true,
    module: {
      getAnalystRecords: () => [record],
      describeSatellite: () => ({
        orbitClass: 'LEO',
        inclinationDeg: 98.2,
        sensor: { label: 'OLI', swathKm: 185 },
      }),
    },
  };
  const dataManager = {
    layers: new Map([[layer.id, layer]]),
    isEnabled: () => true,
    getAll: () => [layer],
    subscribe: () => () => {},
  };
  cards.connect({
    dataManager: () => dataManager,
    regionalBrief: async () => null,
    previews: () => null,
    canFollow: () => false,
    follow() {},
    flyTo() {},
    ask() {},
  });
  t.after(() => {
    cards.connect(null);
    chrome.detach(owner);
    app.unmount();
    globalThis.fetch = realFetch;
  });
  chrome.publish(owner, 'global-context-panel', { collapsed: false });
  cards.select({ layerId: 'satellites', id: '39084' }, { follow: false });
  await nextTick();
  await turn();
  await nextTick();
  const tiles = [
    ...document.querySelectorAll('#entity-card .entity-card__tile'),
  ].map((tile) => [
    tile.querySelector('span').textContent,
    tile.querySelector('strong').textContent,
  ]);
  assert.ok(tiles.length <= 4, `${tiles.length} tiles`);
  assert.ok(tiles.length <= 3, 'three tiles, each on one line');
  assert.deepEqual(tiles.at(-1), ['Inclination', '98.2°']);
  assert.equal(
    tiles.some(([label]) => label === 'Orbit'),
    false,
    'the orbit class is not a tile',
  );
  const facts = [
    ...document.querySelectorAll(
      '#entity-card .entity-card__more .entity-card__fact',
    ),
  ].map((fact) => [
    fact.querySelector('dt').textContent,
    fact.querySelector('dd').textContent,
  ]);
  assert.ok(
    facts.some(([label, value]) => label === 'Orbit' && value === 'LEO'),
    'Orbit · LEO under More details',
  );
  assert.equal(
    document.querySelector('#entity-card .entity-hero')?.dataset.hero,
    'satellite',
  );
});

test('the credit sits in the view’s foot, the card maps’ full-width strip', async (t) => {
  const $$ = mount(t, { lat: 48.85, lon: 2.35, active: true });
  await turn();
  const [foot] = $$('.satellite-ground__foot');
  assert.ok(foot.classList.contains('map-foot'));
  assert.equal(
    foot.querySelector('.map-credit')?.textContent,
    ESRI_IMAGERY_PLACES_CARD_CREDIT,
  );
});

test('the rings and the HUD hold still until the preview plays, the still taken either way', async (t) => {
  const props = reactive({
    lat: 48.85,
    lon: 2.35,
    active: true,
    moving: false,
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const app = createApp({ render: () => h(SatelliteGroundView, { ...props }) });
  app.mount(host);
  t.after(() => {
    app.unmount();
    globalThis.fetch = realFetch;
  });
  await turn();
  await nextTick();
  const root = host.querySelector('.satellite-ground');
  assert.ok(root.classList.contains('is-still'));
  assert.equal(
    host.querySelectorAll('.satellite-ground__tile').length,
    18,
    'the still is taken',
  );
  props.moving = true;
  await nextTick();
  assert.equal(root.classList.contains('is-still'), false);
  props.moving = false;
  await nextTick();
  assert.ok(root.classList.contains('is-still'));
  // Mounted with no say, it holds still.
  assert.equal(SatelliteGroundView.props.moving.default, false);
});

test('held still, the rings and every HUD mark are paused; reduced motion stops them outright', () => {
  const paused = css.match(
    /\.satellite-ground\.is-still\s+:is\(([^)]*)\)\s*\{([^}]*)\}/,
  );
  assert.ok(paused, 'a rule for the still view');
  const targets = paused[1].split(',').map((part) => part.trim());
  assert.ok(targets.includes('.satellite-ground__ring'));
  assert.ok(targets.includes('.preview-hud *'));
  assert.match(paused[2], /animation-play-state:\s*paused/);
  const reduced = [
    ...css.matchAll(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g,
    ),
  ]
    .map((m) => m[1])
    .join('\n');
  assert.match(reduced, /\.satellite-ground__ring\s*\{\s*animation:\s*none/);
  assert.match(
    reduced,
    /\.preview-hud \*,[\s\S]*?animation:\s*none !important/,
  );
});

async function mountSatelliteCard(t) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const app = createApp(ContextView).use(pinia);
  app.mount(host);
  const cards = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  const record = {
    noradId: '39084',
    name: 'LANDSAT 8',
    lat: 48.85,
    lon: 2.35,
    altitudeM: 705_000,
    speedMps: 7500,
  };
  const layer = {
    id: 'satellites',
    name: 'Satellites',
    enabled: true,
    module: {
      getAnalystRecords: () => [record],
      describeSatellite: () => ({ orbitClass: 'LEO', inclinationDeg: 98.2 }),
    },
  };
  const dataManager = {
    layers: new Map([[layer.id, layer]]),
    isEnabled: () => true,
    getAll: () => [layer],
    subscribe: () => () => {},
  };
  cards.connect({
    dataManager: () => dataManager,
    regionalBrief: async () => null,
    previews: () => null,
    canFollow: () => false,
    follow() {},
    flyTo() {},
    ask() {},
  });
  t.after(() => {
    cards.connect(null);
    chrome.detach(owner);
    app.unmount();
    globalThis.fetch = realFetch;
  });
  chrome.publish(owner, 'global-context-panel', { collapsed: false });
  cards.select({ layerId: 'satellites', id: '39084' }, { follow: false });
  await nextTick();
  await turn();
  await nextTick();
}

/** Reduced motion as the page reports it, with its change listeners. */
function motionSetting(t, reduce) {
  const listeners = new Set();
  const query = {
    get matches() {
      return reduce.value;
    },
    addEventListener: (type, cb) => listeners.add(cb),
    removeEventListener: (type, cb) => listeners.delete(cb),
  };
  const real = globalThis.matchMedia;
  globalThis.matchMedia = () => query;
  t.after(() => {
    globalThis.matchMedia = real;
  });
  return {
    change: () => listeners.forEach((cb) => cb({ matches: reduce.value })),
  };
}

test('a satellite card’s ground view starts paused: Play moves it, Pause stops it', async (t) => {
  motionSetting(t, { value: false });
  await mountSatelliteCard(t);
  const ground = () =>
    document.querySelector('#entity-card .entity-hero .satellite-ground');
  const play = () =>
    document.querySelector(
      '#entity-card .entity-hero .entity-card__preview-play',
    );
  assert.ok(ground().classList.contains('is-still'), 'paused until Play');
  assert.equal(play().getAttribute('aria-label'), 'Play preview');
  play().click();
  await nextTick();
  assert.equal(
    ground().classList.contains('is-still'),
    false,
    'Play starts it',
  );
  assert.equal(play().getAttribute('aria-label'), 'Pause preview');
  play().click();
  await nextTick();
  assert.ok(ground().classList.contains('is-still'), 'Pause stops it');
});

test('with reduced motion the ground view holds still, playing or not', async (t) => {
  const reduce = { value: false };
  const motion = motionSetting(t, reduce);
  await mountSatelliteCard(t);
  const ground = () =>
    document.querySelector('#entity-card .entity-hero .satellite-ground');
  document
    .querySelector('#entity-card .entity-hero .entity-card__preview-play')
    .click();
  await nextTick();
  assert.equal(ground().classList.contains('is-still'), false);
  reduce.value = true;
  motion.change();
  await nextTick();
  assert.ok(ground().classList.contains('is-still'));
  // Play pressed again while motion is reduced moves nothing.
  document
    .querySelector('#entity-card .entity-hero .entity-card__preview-play')
    .click();
  await nextTick();
  assert.ok(ground().classList.contains('is-still'));
});

// The ground under a satellite moves on: while the view shows, its still is
// taken again once the craft has gone a quarter of its swath, at most every
// 30 s, so the picture and its label name the ground it sees now.
test('the ground view is taken again as the satellite moves on, at most every 30 s', async (t) => {
  const shown = reactive({ lat: 10, lon: 20, active: true, swathKm: 100 });
  const $$ = mount(t, null, shown);
  await turn();
  await nextTick();
  const where = () => $$('.satellite-ground__label strong')[0]?.textContent;
  assert.match(where(), /10\.00°N 20\.00°E/);
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  // A few km on: the still holds.
  shown.lat = 10.05;
  await turn();
  await nextTick();
  assert.match(where(), /10\.00°N/);
  // Far on, but within 30 s of the last still: it still holds.
  shown.lat = 12;
  await turn();
  await nextTick();
  assert.match(where(), /10\.00°N/);
  // Far on, after 30 s: a new still at the craft's new ground.
  Date.now = () => realNow() + 31_000;
  shown.lat = 12.5;
  await turn();
  await nextTick();
  await turn();
  await nextTick();
  assert.match(where(), /12\.50°N 20\.00°E/);
  Date.now = () => realNow() + 62_000;
  Object.assign(shown, { lat: 0, lon: 179, swathKm: 1000 });
  await turn();
  await nextTick();
  assert.match(where(), /179\.00°E/);
  Date.now = () => realNow() + 93_000;
  shown.lon = -179;
  await turn();
  await nextTick();
  assert.match(
    where(),
    /179\.00°E/,
    '222 km across the dateline is within the 250 km threshold',
  );
});
