// The card's close-up map: how close it looks by kind of item, tiles that
// meet without a seam, Esri's place names over the imagery with a credit
// naming every source on screen, a caption naming the place itself, and an icon centred in its
// circle. Over happy-dom; the stylesheet is checked where layout matters.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp, h, nextTick, reactive } from 'vue';
import {
  CLOSE_UP_ZOOM,
  cityCaption,
  closeUpPlace,
  closeUpZoom,
  tileBlock,
} from './mapTiles.js';
import {
  ESRI_IMAGERY_CREDIT,
  ESRI_IMAGERY_PLACES_CARD_CREDIT,
  ESRI_IMAGERY_PLACES_CREDIT,
  ESRI_PLACES_TILES,
  ESRI_TILES,
} from '../maps/attribution.js';
import CloseUpMap from './views/panels/CloseUpMap.vue';

// Every source the long credit names, each to be read without hovering.
const MAP_SOURCES = [
  'Powered by Esri',
  'Maxar',
  'Earthstar Geographics',
  'GIS User Community',
  'HERE',
  'Garmin',
  '© OpenStreetMap contributors',
];

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = withoutComments(
  fs.readFileSync(new URL('./styles/entity-card.css', import.meta.url), 'utf8'),
);

test('the zoom table: each kind looks as close as suits it, anything else the default', () => {
  const within = (kind, low, high) => {
    const zoom = CLOSE_UP_ZOOM[kind];
    assert.ok(zoom >= low && zoom <= high, `${kind}: z${zoom}`);
  };
  within('airport', 11, 12);
  for (const kind of [
    'fire',
    'fire perimeter',
    'vessel',
    'earthquake',
    'installation',
  ])
    within(kind, 11, 12);
  within('place', 13, 14);
  within('camera', 15, 16);
  within('plate reader', 15, 16);
  assert.ok(Number.isInteger(CLOSE_UP_ZOOM.default));
  assert.equal(closeUpZoom({ kind: 'airport' }), CLOSE_UP_ZOOM.airport);
  assert.equal(closeUpZoom({ kind: 'camera' }), CLOSE_UP_ZOOM.camera);
  assert.equal(closeUpZoom({ kind: 'storm' }), CLOSE_UP_ZOOM.default);
  assert.equal(closeUpZoom(null), CLOSE_UP_ZOOM.default);
});

test('tiles sit whole pixels apart, one tile step from each other, so no seam shows', () => {
  for (const [lat, lon, zoom] of [
    [30.2672, -97.7431, 14],
    [-33.8688, 151.2093, 12],
    [64.1466, -21.9426, 16],
    [0.0001, 179.9999, 11],
  ]) {
    const tiles = tileBlock(lat, lon, zoom);
    assert.equal(tiles.length, 9);
    for (const tile of tiles) {
      assert.ok(Number.isInteger(tile.left), `${tile.key} left ${tile.left}`);
      assert.ok(Number.isInteger(tile.top), `${tile.key} top ${tile.top}`);
    }
    const lefts = [...new Set(tiles.map((tile) => tile.left))].sort(
      (a, b) => a - b,
    );
    assert.deepEqual(
      lefts.slice(1).map((left, i) => left - lefts[i]),
      [256, 256],
    );
    // The spot is within a pixel of the centre tile.
    const centre = tiles[4];
    assert.ok(centre.left <= 0 && centre.left >= -256);
    assert.ok(centre.top <= 0 && centre.top >= -256);
  }
  // Each tile is drawn a pixel larger than its step.
  const rule = css.match(/\.close-up-map__tile\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /width:\s*257px/);
  assert.match(rule, /height:\s*257px/);
});

test('the same block reads any tile service: World Imagery by default, the place names when asked', () => {
  const imagery = tileBlock(30.2672, -97.7431, 12);
  const names = tileBlock(30.2672, -97.7431, 12, ESRI_PLACES_TILES);
  assert.ok(imagery[4].src.startsWith(ESRI_TILES.split('{z}')[0]));
  assert.match(
    names[4].src,
    /^https:\/\/services\.arcgisonline\.com\/ArcGIS\/rest\/services\/Reference\/World_Boundaries_and_Places\/MapServer\/tile\/12\/\d+\/\d+$/,
  );
  assert.deepEqual(
    names.map(({ left, top }) => [left, top]),
    imagery.map(({ left, top }) => [left, top]),
    'the names sit exactly over the imagery',
  );
});

test('the caption names an airport and a place from search by themselves; anything else by the nearest city', () => {
  const airport = {
    name: 'San Francisco International Airport',
    city: 'San Francisco',
    country: 'US',
  };
  assert.equal(
    closeUpPlace({ layerId: 'place', kind: 'airport', place: { airport } }),
    'San Francisco International Airport, San Francisco, United States',
  );
  assert.equal(
    closeUpPlace({
      layerId: 'place',
      kind: 'place',
      title: 'Congress Ave Bridge',
      identity: { label: 'Congress Ave Bridge, Austin, Texas' },
      place: { airport: null },
    }),
    'Congress Ave Bridge, Austin, Texas',
  );
  assert.equal(
    closeUpPlace({ layerId: 'local-firms', kind: 'fire', title: 'Fire' }),
    null,
  );
  assert.equal(closeUpPlace(null), null);
  assert.equal(
    cityCaption({ name: 'Austin', country: 'US' }),
    'Austin, United States',
  );
  assert.equal(cityCaption({ name: 'Nowhere' }), 'Nowhere');
  assert.equal(cityCaption(null), '');
});

function mount(t, props) {
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const app = createApp({ render: () => h(CloseUpMap, props) });
  app.mount(host);
  t.after(() => app.unmount());
  return (selector) => [...host.querySelectorAll(selector)];
}

test('the map lays Esri place names over the imagery, at the zoom for its kind, crediting every source on screen', async (t) => {
  const $$ = mount(t, {
    lat: 37.6213,
    lon: -122.379,
    icon: 'flight',
    card: {
      layerId: 'place',
      kind: 'airport',
      place: {
        airport: {
          name: 'San Francisco International Airport',
          city: 'San Francisco',
          country: 'US',
        },
      },
    },
  });
  await nextTick();
  const tiles = $$('.close-up-map__tile:not(.close-up-map__tile--labels)');
  const labels = $$('.close-up-map__tile--labels');
  assert.equal(tiles.length, 9);
  assert.equal(labels.length, 9);
  for (const img of tiles)
    assert.match(
      img.getAttribute('src'),
      /World_Imagery\/MapServer\/tile\/12\//,
    );
  for (const img of labels)
    assert.match(
      img.getAttribute('src'),
      /World_Boundaries_and_Places\/MapServer\/tile\/12\//,
    );
  const images = $$('.close-up-map__tile');
  assert.ok(
    images.indexOf(labels[0]) > images.indexOf(tiles.at(-1)),
    'names drawn after, so over, the imagery',
  );
  const [credit] = $$('.close-up-map__credit');
  assert.equal(credit.textContent, ESRI_IMAGERY_PLACES_CARD_CREDIT);
  for (const source of MAP_SOURCES)
    assert.ok(
      credit.textContent.includes(source),
      `${source} is credited on screen`,
    );
  assert.equal(credit.getAttribute('title'), ESRI_IMAGERY_PLACES_CREDIT);
  assert.equal(
    credit.getAttribute('tabindex'),
    '0',
    'its long form is a focus away',
  );
  assert.equal(
    credit.closest('[aria-hidden="true"]'),
    null,
    'read out, not hidden',
  );
  assert.ok(ESRI_IMAGERY_PLACES_CREDIT.startsWith(ESRI_IMAGERY_CREDIT));
  assert.match(ESRI_IMAGERY_PLACES_CREDIT, /OpenStreetMap contributors/);
  const [label] = $$('.close-up-map__label');
  assert.match(
    label.textContent,
    /San Francisco International Airport, San Francisco, United States/,
  );
  assert.equal($$('.close-up-map__icon')[0].textContent, 'flight');
});

// The rules that apply to a card map's credit, its foot and its caption,
// in the card's stylesheet and the phone's.
const mobileCss = withoutComments(
  fs.readFileSync(
    new URL('./styles/mobile-shell.css', import.meta.url),
    'utf8',
  ),
);
const rulesFor = (pattern) =>
  [css, mobileCss].flatMap((sheet) =>
    [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => pattern.test(selector))
      .map(([, selector, body]) => ({ selector: selector.trim(), body })),
  );
const rem = (body) => parseFloat(/font-size:\s*([\d.]+)rem/.exec(body)?.[1]);

test('the credit is shown in full at any width: no clamp, cap, clip or hover needed', () => {
  const rules = rulesFor(
    /\.map-credit\b|\.close-up-map__credit\b|\.satellite-ground__credit\b/,
  );
  assert.ok(rules.length > 0);
  for (const { selector, body } of rules) {
    assert.doesNotMatch(body, /line-clamp/, `${selector}: no line clamp`);
    assert.doesNotMatch(body, /max-(width|height)/, `${selector}: no cap`);
    assert.doesNotMatch(
      body,
      /overflow:\s*(hidden|clip)/,
      `${selector}: no clip`,
    );
    assert.doesNotMatch(body, /white-space:\s*nowrap/, `${selector}: it wraps`);
    assert.doesNotMatch(body, /text-overflow/, `${selector}: no ellipsis`);
    assert.doesNotMatch(body, /display:\s*(-webkit-box|none)/, selector);
    assert.doesNotMatch(
      body,
      /(^|[\s;])(height|width):/,
      `${selector}: no fixed size`,
    );
  }
  assert.equal(
    rules.some(({ selector }) => /:hover/.test(selector)),
    false,
    'nothing is kept for hover',
  );
});

test('the credit is a strip across the map’s foot, on the caption’s backdrop, its type no smaller', () => {
  const credit = css.match(/(?:^|\})\s*\.map-credit\s*\{([^}]*)\}/)?.[1] || '';
  const label = css.match(/\.close-up-map__label\s*\{([^}]*)\}/)?.[1] || '';
  const backdrop = /background:\s*(rgba\(5, 8, 11, 0\.7\))/;
  assert.match(label, backdrop);
  assert.equal(credit.match(backdrop)?.[1], label.match(backdrop)?.[1]);
  assert.match(credit, /align-self:\s*stretch/, 'the full width');
  assert.ok(rem(credit) >= rem(label), `${rem(credit)} vs ${rem(label)} rem`);
  const foot = css.match(/(?:^|\})\s*\.map-foot\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(foot, /position:\s*absolute/);
  assert.match(foot, /\bbottom:\s*0/);
  assert.match(foot, /inset-inline:\s*0/, 'edge to edge, either direction');
  assert.doesNotMatch(foot, /(^|[\s;])(left|right):/);
  assert.match(foot, /flex-direction:\s*column/, 'the caption over the credit');
  // In a hero with a preview switch the foot sits above the switch: 22 px
  // buttons in a box with 2 px padding and a 1 px border, 6 px up.
  const lifted =
    css.match(
      /\.entity-hero:has\(> \.entity-card__preview-switch\) \.map-foot\s*\{([^}]*)\}/,
    )?.[1] || '';
  assert.ok(
    parseFloat(/bottom:\s*(\d+)px/.exec(lifted)?.[1]) >= 6 + 22 + 4 + 2,
  );
  // The phone keeps it at the very foot, the switch being hidden there.
  assert.match(
    mobileCss,
    /body\.mobile-shell #entity-card > \.entity-hero \.map-foot\s*\{\s*bottom:\s*0;/,
  );
  assert.match(label, /max-width:\s*calc\(100% - /);
  assert.match(label, /margin-inline-start:/);
  assert.match(label, /text-overflow:\s*ellipsis/);
});

test('the caption and the credit share the foot, the caption first', async (t) => {
  const $$ = mount(t, { lat: 10, lon: 20, card: null });
  await nextTick();
  const [foot] = $$('.close-up-map__foot');
  assert.ok(foot.classList.contains('map-foot'));
  assert.deepEqual(
    [...foot.children].map((child) => child.className),
    ['close-up-map__label', 'close-up-map__credit map-credit'],
  );
  assert.equal(foot.closest('[aria-hidden="true"]'), null);
});

// Every stylesheet, for any rule that would set the marker's display.
const allCss = fs
  .readdirSync(new URL('./styles/', import.meta.url))
  .filter((name) => name.endsWith('.css'))
  .map((name) =>
    withoutComments(
      fs.readFileSync(new URL(`./styles/${name}`, import.meta.url), 'utf8'),
    ),
  )
  .join('\n');

test("a vessel's map shows the sprite the map draws it with, not a glyph", async (t) => {
  const $$ = mount(t, {
    lat: 46.5,
    lon: -84.35,
    icon: 'directions_boat',
    card: { layerId: 'ais-live-vessels', kind: 'vessel', shipType: 'tanker' },
  });
  await nextTick();
  const [ring] = $$('.close-up-map__icon');
  const mark = ring.querySelector('.entity-mark');
  assert.equal(mark.dataset.mark, 'tanker');
  assert.equal(mark.textContent, '', 'no glyph text');
  assert.match(mark.getAttribute('style') || '', /mask-image:\s*url\(/);
  assert.equal(ring.getAttribute('aria-hidden'), 'true');
});

test('the marker is centred in its circle whatever the mark', () => {
  const rule = [
    ...css.matchAll(/([^{}]*\.close-up-map__icon[^{}]*)\{([^}]*)\}/g),
  ].find(([, selector]) => !/:is\(/.test(selector));
  assert.ok(rule, 'the marker rule is present');
  const [, selector, body] = rule;
  // The ring is its own element around the mark, so no icon font rule
  // reaches it.
  assert.match(selector.trim(), /^\.close-up-map \.close-up-map__icon$/);
  assert.match(body, /display:\s*grid/);
  assert.match(body, /place-items:\s*center/);
  assert.match(body, /line-height:\s*1;/);
  assert.match(body, /text-align:\s*center/);
  assert.match(body, /border-radius:\s*50%/);
  const width = body.match(/\bwidth:\s*([\d.]+rem)/)?.[1];
  assert.equal(body.match(/\bheight:\s*([\d.]+rem)/)?.[1], width, 'a circle');
  assert.match(body, /transform:\s*translate\(-50%,\s*-50%\)/);
  // No other rule turns the marker into a block or another layout.
  for (const [, other, otherBody] of allCss.matchAll(
    /([^{}]*\.close-up-map__icon[^{}]*)\{([^}]*)\}/g,
  )) {
    if (other === selector) continue;
    assert.doesNotMatch(
      otherBody,
      /display:\s*(block|inline|flex|inline-block)\b/,
      other.trim(),
    );
  }
  // The card's placeholder glyph uses the same pattern.
  const glyph =
    css.match(
      /\.entity-hero__glyph\.material-symbols-outlined\s*\{([^}]*)\}/,
    )?.[1] || '';
  assert.match(glyph, /display:\s*grid/);
  assert.match(glyph, /place-items:\s*center/);
  assert.match(glyph, /line-height:\s*1;/);
});

test('a map kept behind another view asks for no new tiles as its item moves, and catches up when shown again', async (t) => {
  const props = reactive({
    lat: 37.6213,
    lon: -122.379,
    icon: 'flight',
    active: true,
    card: { kind: 'airport', place: { airport: { name: 'SFO' } } },
  });
  const all = mount(t, props);
  await nextTick();
  const sources = () =>
    all('.close-up-map__tile').map((img) => img.getAttribute('src'));
  const first = sources();
  assert.equal(first.length, 18, 'imagery and place names');

  // Behind the photo or the model, the item crosses several tiles.
  props.active = false;
  await nextTick();
  for (const step of [1, 2, 3]) {
    props.lat = 37.6213 + step * 0.2;
    props.lon = -122.379 + step * 0.2;
    await nextTick();
    assert.deepEqual(sources(), first, `no new tile URL at step ${step}`);
  }

  // Shown again: the map is taken where the item is now.
  props.active = true;
  await nextTick();
  const now = sources();
  assert.equal(now.length, 18);
  assert.notDeepEqual(now, first, 'it caught up');
  const block = tileBlock(props.lat, props.lon, 12).map((tile) => tile.src);
  assert.deepEqual(now.slice(0, 9), block);
});

test('a map used without the prop is shown and follows its item as before', async (t) => {
  const props = reactive({
    lat: 30.27,
    lon: -97.74,
    icon: 'place',
    card: { kind: 'airport', place: { airport: { name: 'AUS' } } },
  });
  const all = mount(t, props);
  await nextTick();
  const sources = () =>
    all('.close-up-map__tile').map((img) => img.getAttribute('src'));
  const first = sources();
  props.lat += 0.5;
  await nextTick();
  assert.notDeepEqual(sources(), first);
});
