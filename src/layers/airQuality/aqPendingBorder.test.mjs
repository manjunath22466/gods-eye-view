import assert from 'node:assert/strict';
import test from 'node:test';
import { createAirQualityLayer } from './index.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

test('pending first read near a border station does not claim absence', async () => {
  const viewer = {};
  bindFakeDraw(viewer);
  let resolve;
  const layer = createAirQualityLayer({
    source: {
      getSnapshot: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  layer.init(viewer);
  layer.enable();
  const pending = layer.update();
  const dearborn = [42.322, -83.176];
  const found = layer.getValueAt(...dearborn);
  resolve([
    {
      id: 'eccc:Windsor',
      provider: 'eccc',
      scale: 'AQHI',
      value: 3,
      band: 'low',
      stationId: 'W',
      name: 'Windsor',
      zone: 'o',
      lat: 42.3,
      lon: -83.03,
      observedMs: Date.now(),
      color: '#4cc9f0',
      label: '3',
      risk: 'Low health risk',
      note: null,
    },
  ]);
  await pending;
  assert.equal(found, null);
  assert.equal(layer.getValueAt(...dearborn).value, 'AQHI 3 · Low');
  layer.destroy();
});
