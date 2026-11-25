// A straight-down local view rotated 45 deg from north: the screen footprint
// is a diamond, its four ground corners' lat/lon box is twice its area. A
// point inside that box but outside the diamond is off screen and must not
// count as "In view".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { useEntityCardStore } from './stores/entityCard.js';

test('rotated view counts only what projects onto the screen', () => {
  const d = 0.1; // north-up half-width of the footprint, degrees (at the equator)
  const r = d * Math.SQRT2; // the rotated footprint's corner offset
  // Ground corners of the 45 deg-rotated screen (top-left, bottom-left,
  // bottom-right, top-right), as the renderer picks them.
  const corners = [
    { lat: r, lon: 0 },
    { lat: 0, lon: -r },
    { lat: -r, lon: 0 },
    { lat: 0, lon: r },
  ];
  const records = [
    { id: 'centre', name: 'Centre', lat: 0, lon: 0 },
    // |lat| + |lon| = 1.7 d > sqrt(2) d: outside the diamond, inside the box.
    { id: 'offscreen', name: 'Offscreen', lat: 0.85 * d, lon: 0.85 * d },
  ];
  const row = {
    id: 'earthquakes',
    enabled: true,
    module: { getAnalystRecords: () => records },
  };
  const store = useEntityCardStore(createPinia());
  store.connect({
    dataManager: () => ({
      layers: new Map([[row.id, row]]),
      isEnabled: () => true,
      getAll: () => [row],
      subscribe() {},
    }),
  });
  const view = {
    center: { lat: 0, lon: 0 },
    rect: { west: -r, south: -r, east: r, north: r },
    heightM: 20_000,
    eye: { lat: 0, lon: 0 },
  };
  const read = () =>
    store.inView({
      perLayer: 3,
      breakdown: true,
      includeEmpty: true,
      viewport: true,
    })[0];
  store.setView({
    ...view,
    corners: [
      { lat: r, lon: -r },
      { lat: -r, lon: -r },
      { lat: -r, lon: r },
      { lat: r, lon: r },
    ],
  });
  assert.equal(read().count, 2);
  const omnibar = store.inView({ viewport: true });
  assert.equal(omnibar[0].count, 2);
  store.setView({ ...view, corners });
  const group = read();
  const ids = (group?.items ?? []).map((item) => item.identity.id);
  assert.ok(ids.includes('centre'));
  assert.ok(!ids.includes('offscreen'), `off-screen point counted: ${ids}`);
  assert.equal(group.count, 1);
  assert.deepEqual(store.inView({ viewport: true }), omnibar);
});
