// A camera pin's still is the frame as it was, saved small: never a URL
// that would fetch a newer frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STILL_MAX_CHARS,
  STILL_MAX_WIDTH,
  captureFrameStill,
  encodeStill,
} from './frameStill.js';

/** A canvas double whose data URL grows with its width and quality. */
function fakeDocument({ bytesPerPixel = 1, taint = false } = {}) {
  const made = [];
  return {
    made,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage(source, x, y, w, h) {
            canvas.drawn = { source, w, h };
          },
        }),
        toDataURL(type, quality) {
          if (taint) throw new Error('SecurityError');
          const size = Math.round(
            canvas.width * canvas.height * bytesPerPixel * quality,
          );
          return `data:${type};base64,${'A'.repeat(size)}`;
        },
      };
      made.push(canvas);
      return canvas;
    },
  };
}

test('a frame is saved downscaled to at most 320 px wide, as a JPEG data URL', () => {
  const document = fakeDocument({ bytesPerPixel: 0.2 });
  const url = encodeStill(
    { naturalWidth: 1280, naturalHeight: 720 },
    { document },
  );
  assert.match(url, /^data:image\/jpeg;base64,/);
  assert.equal(document.made[0].width, STILL_MAX_WIDTH);
  assert.equal(document.made[0].height, 180);
  assert.ok(url.length <= STILL_MAX_CHARS);
});

test('a still too large is made smaller and plainer until it fits, or not kept', () => {
  const fits = fakeDocument({ bytesPerPixel: 2 });
  const url = encodeStill(
    { naturalWidth: 1280, naturalHeight: 720 },
    { document: fits },
  );
  assert.ok(url && url.length <= STILL_MAX_CHARS, 'shrunk to fit');
  assert.ok(fits.made.length > 1, 'it took more than one try');
  const never = fakeDocument({ bytesPerPixel: 1000 });
  assert.equal(
    encodeStill(
      { naturalWidth: 1280, naturalHeight: 720 },
      { document: never },
    ),
    '',
  );
});

test('an unloaded or tainted frame gives no still', () => {
  assert.equal(
    encodeStill(
      { naturalWidth: 0, naturalHeight: 0 },
      { document: fakeDocument() },
    ),
    '',
  );
  assert.equal(
    encodeStill(
      { naturalWidth: 640, naturalHeight: 360 },
      { document: fakeDocument({ taint: true }) },
    ),
    '',
  );
});

test('with nothing on screen the frame URL is read once, and the still is its data, not the URL', async () => {
  const loads = [];
  class FakeImage {
    set src(value) {
      loads.push(value);
      this.naturalWidth = 640;
      this.naturalHeight = 360;
      queueMicrotask(() => this.onload());
    }
  }
  const document = fakeDocument({ bytesPerPixel: 0.2 });
  const still = await captureFrameStill(
    { shown: null, url: '/api/cctv/frame/cam-1?ts=1' },
    { document, Image: FakeImage },
  );
  assert.deepEqual(loads, ['/api/cctv/frame/cam-1?ts=1']);
  assert.match(still, /^data:image\/jpeg/);
  assert.doesNotMatch(still, /\/api\/cctv/);
  // What the card shows wins, with no request at all.
  const shown = await captureFrameStill(
    {
      shown: { naturalWidth: 640, naturalHeight: 360 },
      url: '/api/cctv/frame/cam-1?ts=2',
    },
    { document, Image: FakeImage },
  );
  assert.match(shown, /^data:image\/jpeg/);
  assert.equal(loads.length, 1);
});
