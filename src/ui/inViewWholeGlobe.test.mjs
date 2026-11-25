// Below the globe-height cutoff, a whole-globe view rectangle (the renderer's
// fallback when fewer than two canvas corners land on Earth, or the bridge's
// substitute for a missing rectangle) must not make the far side of Earth
// count as "In view".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { useEntityCardStore } from './stores/entityCard.js';

test('whole-globe rectangle at 4,800 km does not count the antipode', () => {
  // Square canvas, 60 deg FOV, straight down at 4,800 km: the corners are
  // 39.2 deg off-axis, Earth's limb only 34.8 deg, so every corner misses
  // and the renderer answers with the whole globe.
  const records = [
    { id: 'near', name: 'Near', lat: 0, lon: 0 },
    { id: 'anti', name: 'Antipode', lat: 0, lon: 180 },
  ];
  const row = {
    id: 'earthquakes',
    enabled: true,
    module: { getAnalystRecords: () => records },
  };
  const store = useEntityCardStore(createPinia());
  const manager = {
    layers: new Map([[row.id, row]]),
    isEnabled: () => true,
    getAll: () => [row],
    subscribe() {},
  };
  store.connect({ dataManager: () => manager });
  store.setView({
    center: { lat: 0, lon: 0 },
    rect: { west: -180, south: -90, east: 180, north: 90 },
    heightM: 4_800_000,
    eye: { lat: 0, lon: 0 },
  });
  const [group] = store.inView({
    perLayer: 3,
    breakdown: true,
    includeEmpty: true,
    viewport: true,
  });
  const ids = (group?.items ?? []).map((item) => item.identity.id);
  assert.ok(ids.includes('near'), 'the record under the camera is in view');
  assert.ok(!ids.includes('anti'), `antipode counted as in view: ${ids}`);
  assert.equal(group.count, 1);
});
