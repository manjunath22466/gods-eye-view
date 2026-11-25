import { test } from 'node:test';
import assert from 'node:assert/strict';
import { from, pausedRoute, to } from '../../testSupport/pausedRoute.mjs';

test('a shown, paused route draws the craft after a position update', async () => {
  const { preview, widget } = await pausedRoute();
  const before = widget.renders;
  preview.update({ from, to, at: { lat: 50, lon: -40 } });
  for (let i = 0; i < 5; i++) widget.tick();
  assert.ok(
    widget.renders > before,
    `no frame drawn after the update (renders ${before} -> ${widget.renders})`,
  );
  preview.destroy();
});

test('a hidden paused route draws nothing on an update', async () => {
  const { preview, widget } = await pausedRoute();
  preview.setShown(false);
  const before = widget.renders;
  preview.update({ from, to, at: { lat: 50, lon: -40 } });
  for (let i = 0; i < 5; i++) widget.tick();
  assert.equal(widget.renders, before);
  preview.setShown(true);
  assert.equal(widget.renders, before + 1);
  preview.destroy();
});

test('route readiness follows the first frame with geometry', async () => {
  const { cesiumCardPreviews } = await import('./cardPreviews.js');
  const host = {};
  let frames = 0;
  const preview = cesiumCardPreviews.route(
    host,
    { from, to },
    { onReady: () => frames++ },
  );
  try {
    host.widget.tick();
    assert.equal(frames, 0, 'the plain globe is still waiting for the route');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(frames, 0);
    host.widget.tick();
    host.widget.tick();
    assert.equal(frames, 1);
  } finally {
    preview.destroy();
  }
});

test('model readiness waits for a rendered frame after the mesh is ready', async (t) => {
  const { Cartesian3, Event, Model } = await import('cesium');
  const { cesiumCardPreviews } = await import('./cardPreviews.js');
  const mesh = {
    readyEvent: new Event(),
    boundingSphere: { center: Cartesian3.ZERO, radius: 1 },
  };
  t.mock.method(Model, 'fromGltfAsync', async () => mesh);
  const host = {};
  let frames = 0;
  const preview = cesiumCardPreviews.model(
    host,
    { gltf: new Uint8Array() },
    { onReady: () => frames++ },
  );
  try {
    host.widget.scene.primitives = { add: (m) => m };
    await new Promise((resolve) => setImmediate(resolve));
    host.widget.tick();
    assert.equal(frames, 0);
    const render = t.mock.method(host.widget, 'render', () => {});
    mesh.readyEvent.raiseEvent();
    assert.equal(frames, 0, 'a ready mesh has not yet been drawn');
    render.mock.restore();
    host.widget.tick();
    assert.equal(frames, 1);
    host.widget.tick();
    assert.equal(frames, 1);
  } finally {
    preview.destroy();
  }
});
