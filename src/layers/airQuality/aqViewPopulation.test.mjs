import assert from 'node:assert/strict';
import test from 'node:test';
import { createAirQualityLayer } from './index.js';
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

test('Context summary counts the same visible stations as its rows', async () => {
  const viewer = {};
  bindFakeDraw(viewer, {
    camera: {
      viewRectangle: () => ({ west: -80, south: 43.5, east: -79, north: 44 }),
    },
  });
  const layer = createAirQualityLayer({
    source: {
      getSnapshot: async () => [
        reading('Toronto', 3, 43.65, -79.38),
        reading('Vancouver', 8, 49.28, -123.12, {
          band: 'high',
          label: '8',
          risk: 'High health risk',
        }),
      ],
    },
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  layer.init(viewer);
  layer.enable();
  await layer.update();
  const summary = layer.getContextSummary();
  assert.deepEqual(
    summary.items.map((i) => i.key),
    ['eccc:Toronto'],
    'rows are in view',
  );
  const bands = Object.fromEntries(summary.bands.map((b) => [b.id, b.count]));
  assert.equal(
    summary.caption,
    '1 station reporting',
    'caption counts visible stations',
  );
  assert.deepEqual(
    bands,
    { low: 1, moderate: 0, high: 0, 'very-high': 0 },
    'bar counts visible stations',
  );
  layer.destroy();
});
