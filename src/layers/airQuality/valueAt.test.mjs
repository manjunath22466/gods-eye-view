import assert from 'node:assert/strict';
import test from 'node:test';
import { AIR_QUALITY_VALUE_RADIUS_KM, createAirQualityLayer } from './index.js';
import { airQualityColor, STALE_AFTER_MS } from './model.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const reading = (id, value, lat, lon, overrides = {}) => ({
  id: `eccc:${id}`,
  provider: 'eccc',
  scale: 'AQHI',
  value,
  band: 'low',
  stationId: id,
  name: id,
  zone: 'ont',
  lat,
  lon,
  observedMs: 1_700_000_000_000,
  color: '#4cc9f0',
  label: String(value),
  risk: 'Low health risk',
  note: null,
  ...overrides,
});

// Quantities keep number and unit together with a no-break space.
const plain = (text) => text.replace(/\s/gu, ' ');

function layerWith(rows) {
  const viewer = {};
  bindFakeDraw(viewer);
  const layer = createAirQualityLayer({
    source: { getSnapshot: async () => rows },
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  layer.init(viewer);
  return layer;
}

test('getValueAt reads the nearest station within the radius', async (context) => {
  const now = 1_700_000_000_000 + STALE_AFTER_MS + 1;
  context.mock.method(Date, 'now', () => now);
  const layer = layerWith([
    reading('Toronto', 3, 43.65, -79.38),
    reading('Hamilton', 7, 43.25, -79.87, {
      band: 'high',
      label: '7',
      observedMs: now - STALE_AFTER_MS,
    }),
  ]);
  assert.equal(layer.getValueAt(43.66, -79.4), null, 'off');
  layer.enable();
  assert.equal(layer.getValueAt(43.66, -79.4), null, 'nothing loaded');
  assert.equal(
    layer.getValueAt(48.86, 2.35),
    null,
    'nothing loaded, even outside coverage',
  );
  assert.equal(await layer.update(), true);
  const toronto = layer.getValueAt(43.66, -79.4);
  assert.equal(toronto.value, 'AQHI 3 · Low');
  assert.equal(plain(toronto.detail), 'Toronto · 2 km');
  assert.equal(toronto.at, 1_700_000_000_000);
  assert.equal(toronto.stale, true);
  // The band and its map colour.
  assert.equal(toronto.level, 'low');
  assert.equal(toronto.color, airQualityColor('low'));
  const hamilton = layer.getValueAt(43.26, -79.86);
  assert.equal(hamilton.value, 'AQHI 7 · High');
  assert.equal(hamilton.stale, undefined);
  assert.equal(AIR_QUALITY_VALUE_RADIUS_KM, 50);
  // Outside the network's coverage area: said so, beside the reason.
  const outside = {
    value: null,
    reason: 'No station within 50 km',
    outsideCoverage: true,
  };
  assert.deepEqual(layer.getValueAt(30.27, -97.74), outside, 'Austin');
  assert.deepEqual(layer.getValueAt(41.88, -87.63), outside, 'Chicago');
  assert.deepEqual(
    layer.getValueAt(60.72, -135.05),
    { value: null, reason: 'No station within 50 km' },
    'Whitehorse with only Ontario stations in this snapshot',
  );
  // Inside the network but no station within the radius.
  assert.deepEqual(layer.getValueAt(44.6, -79.4), {
    value: null,
    reason: 'No station within 50 km',
  });
  assert.equal(layer.getValueAt(Number.NaN, -79.4), null);
  layer.disable();
  assert.equal(layer.getValueAt(43.66, -79.4), null);
  layer.destroy();
});

test('getValueAt shows the value alone when a band is unknown', async () => {
  const layer = layerWith([
    reading('Ottawa', 11, 45.42, -75.69, { band: null, label: '10+' }),
  ]);
  layer.enable();
  await layer.update();
  const ottawa = layer.getValueAt(45.42, -75.69);
  assert.equal(ottawa.value, 'AQHI 10+');
  assert.equal(ottawa.level, undefined);
  assert.equal(ottawa.color, undefined);
  layer.destroy();
});

test('Context gets the worst readings, stations by band, and the coverage; a station card its reading on the scale', async () => {
  const layer = layerWith([
    reading('Toronto', 3, 43.65, -79.38),
    reading('Hamilton', 7, 43.25, -79.87, {
      band: 'high',
      label: '7',
      risk: 'High health risk',
    }),
  ]);
  assert.equal(layer.getContextSummary(), null, 'off');
  assert.deepEqual(layer.getBandCounts(), []);
  layer.enable();
  await layer.update();
  // The Weather card's ordering: worst first.
  const highest = layer.getHighestReadings(5);
  assert.deepEqual(
    highest.map(({ name, lead }) => [name, lead]),
    [
      ['Hamilton', 'AQHI 7'],
      ['Toronto', 'AQHI 3'],
    ],
  );
  assert.equal(highest[0].record.id, 'eccc:Hamilton');
  assert.equal(highest[0].band.color, airQualityColor('high'));
  assert.deepEqual(
    layer.getRowControls().list.items.map(({ lead, text }) => [lead, text]),
    [
      ['AQHI 7', 'Hamilton · High health risk'],
      ['AQHI 3', 'Toronto · Low health risk'],
    ],
    'the Weather card lists the same, as before',
  );
  assert.deepEqual(
    layer.getBandCounts().map(({ id, count }) => [id, count]),
    [
      ['low', 1],
      ['moderate', 0],
      ['high', 1],
      ['very-high', 0],
    ],
  );
  const summary = layer.getContextSummary(1);
  assert.equal(summary.caption, '2 stations reporting');
  assert.equal(summary.note, 'Canada only · ECCC AQHI network');
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].text, 'Hamilton · High');
  assert.equal(summary.items[0].record.id, 'eccc:Hamilton');
  // A station's card: its value, band and health message, and its place on
  // the scale's bands.
  const card = layer.describeReading(layer.getAnalystRecords()[0]);
  assert.equal(card.scale, 'AQHI');
  assert.equal(card.risk, `${card.band.label} health risk`);
  assert.deepEqual(
    card.segments.map(({ id, color }) => [id, color]),
    ['low', 'moderate', 'high', 'very-high'].map((id) => [
      id,
      airQualityColor(id),
    ]),
  );
  const total = card.segments.reduce((sum, segment) => sum + segment.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const toronto = layer.describeReading({
    provider: 'eccc',
    value: 3,
    band: 'low',
  });
  assert.equal(toronto.value, '3');
  assert.ok(toronto.at > 0 && toronto.at < 3 / 11);
  assert.equal(layer.describeReading({ provider: 'eccc', value: null }), null);
  layer.destroy();
});
