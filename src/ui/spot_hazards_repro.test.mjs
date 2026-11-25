// Hazard counts and feed availability in the selected card.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import { setContextRadiusKm } from './contextRadius.js';
import SpotConditions from './views/panels/SpotConditions.vue';
import { useOmnibarStore } from './stores/omnibar.js';

const HERE = { lat: 30.27, lon: -97.74 };
const QUAKES =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

function quake(i) {
  return {
    id: `q${i}`,
    type: 'Feature',
    properties: {
      mag: 3.1,
      place: `${10 + i} km N of Austin`,
      time: Date.now(),
    },
    geometry: {
      type: 'Point',
      coordinates: [-97.74 + i * 0.01, 30.3 + i * 0.01, 5],
    },
  };
}

function mount(t, { feeds = {}, pending = false, failing = false } = {}) {
  const realFetch = globalThis.fetch;
  const read = Promise.withResolvers();
  globalThis.fetch = async (url) => {
    if (pending) await read.promise;
    if (failing) return new Response('', { status: 503 });
    const body = feeds[String(url)];
    return body ? Response.json(body) : new Response('', { status: 503 });
  };
  document.body.replaceChildren();
  const pinia = createPinia();
  useOmnibarStore(pinia).connect({
    layers: () => [
      { id: 'earthquakes', name: 'Earthquakes', enabled: false },
      { id: 'weather-cyclones', name: 'Tropical Storms', enabled: false },
      { id: 'fire-perimeters', name: 'Fire Perimeters', enabled: false },
      { id: 'local-firms', name: 'Active Fires', enabled: false },
    ],
  });
  const app = createApp({
    render: () =>
      h(SpotConditions, {
        lat: HERE.lat,
        lon: HERE.lon,
        excludeKey: 'flights:self',
        ownLayer: 'flights',
      }),
  }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => {
    app.unmount();
    read.resolve();
    globalThis.fetch = realFetch;
    setContextRadiusKm(250);
  });
}

const settle = async () => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
};
const hazardBlock = () => document.querySelector('.spot-conditions__hazards');

// The hazard feed cache is module-wide for five minutes; each test moves the clock past it.
let shift = 0;
const realNow = Date.now;
const fresh = (t) => {
  shift += 6 * 60_000;
  const at = shift;
  Date.now = () => realNow() + at;
  t.after(() => {
    Date.now = realNow;
  });
};

test('the hazard heading counts every hazard in the radius when five rows are shown', async (t) => {
  fresh(t);
  mount(t, {
    feeds: {
      [QUAKES]: {
        type: 'FeatureCollection',
        features: Array.from({ length: 8 }, (_, i) => quake(i)),
      },
    },
  });
  await settle();
  const rows = document.querySelectorAll('.spot-conditions__hazards li').length;
  const count = hazardBlock()
    ?.querySelector('.spot-conditions__count')
    ?.textContent?.trim();
  assert.equal(rows, 5, 'five rows shown');
  assert.equal(
    count,
    '8',
    `heading count should be the 8 hazards in the radius, got ${count}`,
  );
  const sources = hazardBlock().querySelector(
    '.spot-conditions__source',
  ).textContent;
  assert.match(sources, /USGS/);
  assert.match(sources, /NOAA NHC: Unavailable/);
  assert.match(sources, /NIFC WFIGS: Unavailable/);
  assert.doesNotMatch(sources, /USGS: Unavailable|NASA FIRMS/);
});

test('pending hazard feeds show a loading indicator', async (t) => {
  fresh(t);
  mount(t, { pending: true });
  await settle();
  assert.ok(hazardBlock(), 'a pending hazard read shows some loading state');
  assert.equal(
    hazardBlock().querySelector('.spot-conditions__count').textContent,
    '…',
  );
  assert.equal(
    hazardBlock().querySelector('.spot-conditions__source').textContent,
    'Loading',
  );
});

test('the hazard block shows unavailable when every requested feed fails', async (t) => {
  fresh(t);
  mount(t, { failing: true });
  await settle();
  assert.ok(
    hazardBlock() !== null,
    'a failed hazard read shows an unavailable state',
  );
  const count = hazardBlock().querySelector('.spot-conditions__count');
  assert.equal(count.textContent, '—');
  assert.equal(count.title, 'Unavailable');
  assert.match(hazardBlock().textContent, /USGS: Unavailable/);
});
