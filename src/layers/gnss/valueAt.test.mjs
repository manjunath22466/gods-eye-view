import assert from 'node:assert/strict';
import test from 'node:test';
import { GNSS_LEVEL_COLORS, createGnssIntegrityLayer } from './index.js';
import { fakeCameraPort } from '../../testSupport/fakeCameraPort.mjs';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const row = (hex, lat, lon, degraded) => ({
  hex,
  lat,
  lon,
  nic: degraded ? 0 : 8,
  nacp: degraded ? 0 : 10,
  gpsLost: false,
  degraded,
});

function layerWith(rows, options = {}) {
  const viewer = { scene: { globe: { show: true } } };
  bindFakeDraw(viewer, { camera: fakeCameraPort().port });
  const layer = createGnssIntegrityLayer({
    source: { getSnapshot: async () => ({ ageMs: 500, rows }) },
    viewAnchor: () => ({ latitude: 50, longitude: 30 }),
    now: () => 10_000,
    monotonicNow: () => 10_000,
    ...options,
  });
  layer.init(viewer);
  return layer;
}

test('getValueAt reads the binned cell under a point', async () => {
  const layer = layerWith([
    row('a1', 50.0, 30.0, false),
    row('a2', 50.001, 30.001, false),
    row('a3', 50.002, 30.002, true),
    // A second cell far away where every aircraft reports low accuracy.
    row('b1', 10.0, 10.0, true),
    row('b2', 10.001, 10.001, true),
    row('b3', 10.002, 10.002, true),
  ]);
  assert.equal(layer.getValueAt(50, 30), null, 'off');
  layer.enable();
  assert.equal(await layer.update(), true);
  const ok = layer.getValueAt(50.0005, 30.0005);
  assert.equal(ok.value, 'Low-accuracy score < 2%');
  assert.equal(ok.detail, '1 of 3 aircraft reported low accuracy');
  assert.equal(ok.at, 9_500);
  // The legend band and its colour, as the map draws the cell.
  assert.equal(ok.level, 'low');
  assert.equal(ok.color, GNSS_LEVEL_COLORS.low);
  const bad = layer.getValueAt(10.0005, 10.0005);
  assert.equal(bad.value, 'Low-accuracy score > 10%');
  assert.equal(bad.detail, '3 of 3 aircraft reported low accuracy');
  assert.equal(bad.level, 'high');
  assert.equal(bad.color, GNSS_LEVEL_COLORS.high);
  // The band in short, beside the score's name.
  assert.equal(ok.short, '< 2%');
  assert.equal(bad.short, '> 10%');
  assert.equal(bad.measure, 'Low-accuracy score');
  assert.equal(layer.getValueAt(-40, 100), null, 'no aircraft there');
  assert.equal(layer.getValueAt(Number.NaN, 30), null);
  assert.equal(layer.getValueAt(95, 30), null);
  layer.disable();
  assert.equal(layer.getValueAt(50, 30), null);
  layer.destroy();
});

test('getValueAt reads the same populated cell on either side of the dateline', async (t) => {
  const layer = layerWith([
    row('a1', 0, 179.999, false),
    row('a2', 0, -179.999, true),
  ]);
  t.after(() => layer.destroy());
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().count, 1);
  const east = layer.getValueAt(0, 179.999);
  assert.equal(east?.at, 9_500);
  assert.deepEqual(layer.getValueAt(0, -179.999), east);
});

test('a point keeps the newest observation time in its own GNSS cell', async (t) => {
  let now = 10_000;
  let rows = [row('a1', 50, 30, false)];
  const layer = layerWith([], {
    now: () => now,
    windowMs: 5_000,
    source: { getSnapshot: async () => ({ ageMs: 500, rows }) },
  });
  t.after(() => layer.destroy());
  layer.enable();
  await layer.update();
  now += 2_000;
  rows = [row('a2', 50, 30, true)];
  await layer.update();
  now += 2_000;
  rows = [row('b1', 10, 10, false)];
  await layer.update();
  assert.equal(layer.getStats().lastUpdate, 13_500);
  assert.equal(layer.getValueAt(10, 10).at, 13_500);
  assert.equal(layer.getValueAt(50, 30).at, 11_500);
  now = 17_000;
  rows = [];
  await layer.update();
  assert.equal(layer.getValueAt(50, 30), null);
  assert.equal(layer.getValueAt(10, 10).at, 13_500);
});

test('the worst sampled areas come first, and Context gets the areas by band and a sample note', async (t) => {
  const layer = layerWith([
    row('a1', 50.0, 30.0, false),
    row('a2', 50.001, 30.001, false),
    row('a3', 50.002, 30.002, true),
    row('b1', 10.0, 10.0, true),
    row('b2', 10.001, 10.001, true),
    row('b3', 10.002, 10.002, true),
  ]);
  t.after(() => layer.destroy());
  assert.deepEqual(layer.getWorstAreas(), [], 'off');
  assert.equal(layer.getContextSummary(), null, 'off');
  layer.enable();
  assert.equal(await layer.update(), true);
  const areas = layer.getWorstAreas(3);
  assert.deepEqual(
    areas.map(({ level, degraded, aircraft, short }) => ({
      level,
      degraded,
      aircraft,
      short,
    })),
    [{ level: 'high', degraded: 3, aircraft: 3, short: '> 10%' }],
    'areas in the best band are not listed',
  );
  assert.ok(
    Math.abs(areas[0].lat - 10) < 0.5 && Math.abs(areas[0].lon - 10) < 0.5,
  );
  assert.equal(areas[0].color, GNSS_LEVEL_COLORS.high);
  assert.equal(layer.getWorstAreas(1).length, 1);
  const summary = layer.getContextSummary(1);
  assert.equal(summary.headline, '2 areas');
  assert.deepEqual(
    summary.bands.map(({ id, count, color }) => ({ id, count, color })),
    [
      { id: 'low', count: 1, color: GNSS_LEVEL_COLORS.low },
      { id: 'medium', count: 0, color: GNSS_LEVEL_COLORS.medium },
      { id: 'high', count: 1, color: GNSS_LEVEL_COLORS.high },
    ],
  );
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].lead, '> 10%');
  assert.equal(summary.items[0].text, '3 of 3 aircraft');
  assert.equal(summary.items[0].lat, areas[0].lat);
  assert.equal(summary.note, 'Sampled around views you visited');
  assert.equal(summary.itemsLabel, 'Least accurate sampled areas');
});

test('an all-good sample lists no areas and no "least accurate" heading', async (t) => {
  const layer = layerWith([
    row('a1', 50.0, 30.0, false),
    row('a2', 50.001, 30.001, false),
    row('a3', 50.002, 30.002, true),
  ]);
  t.after(() => layer.destroy());
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.deepEqual(layer.getWorstAreas(3), []);
  const summary = layer.getContextSummary(3);
  assert.equal(summary.headline, '1 area');
  assert.deepEqual(summary.items, []);
  assert.equal(summary.itemsLabel, undefined);
});
