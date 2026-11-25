// src/ui/mapTiles.test.mjs — the card maps' tiles use the same Web
// Mercator position as the rest of the app (stories' thumbnails).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStill, parseMapStill, tileBlock } from './mapTiles.js';
import { tilePosition } from '../stories/thumbs.js';

test('the tile block centres on the shared Web Mercator position, to the edge of the map', () => {
  for (const [lat, lon, zoom] of [
    [30.2672, -97.7431, 13],
    [-33.86, 151.21, 9],
    [85.04, 0, 10],
    [-85.04, 179.99, 10],
  ]) {
    const { x, y } = tilePosition(lon, lat, zoom);
    const block = tileBlock(lat, lon, zoom);
    const centre = block.find(
      (tile) =>
        tile.left <= 0 && tile.left > -256 && tile.top <= 0 && tile.top > -256,
    );
    assert.equal(
      centre?.key,
      `${zoom}/${Math.floor(x)}/${Math.floor(y)}`,
      `${lat}, ${lon}`,
    );
  }
  // Near the pole the map's own limit (85.0511°) holds, not a rounder 85°.
  const near = parseMapStill(mapStill(85.04, 0, 10));
  const centre = tileBlock(near.lat, near.lon, near.zoom).find(
    (tile) =>
      tile.left <= 0 && tile.left > -256 && tile.top <= 0 && tile.top > -256,
  );
  assert.equal(centre?.key, '10/512/0');
});
