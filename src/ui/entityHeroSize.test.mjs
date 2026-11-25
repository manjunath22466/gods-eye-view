// The card's top image must never collapse: a hero whose layers are all
// absolutely positioned (the close-up map, the satellite ground view, the
// photo, the flight and model views) has no in-flow content to size it, so it needs
// its own height. The test DOM has no layout, so the stylesheet is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(
  new URL('./styles/entity-card.css', import.meta.url),
  'utf8',
);

test('every absolutely laid-out hero kind, the close-up map included, has a height', () => {
  // The rule that lists the hero kinds and gives them a height.
  const rules = [...css.matchAll(/\.entity-hero:is\(([^{]*)\{([^}]*)\}/g)];
  const rule = rules.find(([, , body]) => /\bheight:\s*\d+px/.test(body));
  assert.ok(rule, 'the hero height rule is present');
  const [, selector, body] = rule;
  for (const kind of [
    'flight',
    'model',
    'satellite',
    'photo',
    'place-street',
    'map',
  ])
    assert.match(selector, new RegExp(`data-hero='${kind}'`), kind);
  assert.match(body, /\bheight:\s*\d+px/);
});

// On a phone the hero is a small thumbnail beside the name. A camera's hero
// holds its facts and More info under the feed, so it must not be clipped
// to that thumbnail.
test('a phone shows a camera or street photo card’s top image whole, never as the clipped thumbnail', () => {
  const phone = fs.readFileSync(
    new URL('./styles/mobile-shell.css', import.meta.url),
    'utf8',
  );
  const whole = [
    ...phone.matchAll(
      /body\.mobile-shell\s+#entity-card\s+>\s+\.entity-hero:is\(([^)]*)\)\s*\{([^}]*)\}/g,
    ),
  ].find(([, kinds]) => /data-hero='camera'/.test(kinds));
  assert.ok(whole, 'a whole-width hero rule for the phone is present');
  for (const kind of ['camera', 'street'])
    assert.match(whole[1], new RegExp(`data-hero='${kind}'`), kind);
  assert.match(whole[2], /grid-column:\s*1 \/ -1/);
  assert.match(whole[2], /height:\s*auto/);
  assert.match(whole[2], /overflow:\s*visible/);
  const head = phone.match(
    /#entity-card:has\(\s*> \.entity-hero:is\(([^)]*)\)\s*\)\s*> \.entity-card__head \{\s*grid-column:\s*1 \/ -1/,
  );
  assert.ok(head, 'the name goes full width above it');
  for (const kind of ['camera', 'street'])
    assert.match(head[1], new RegExp(`data-hero='${kind}'`), kind);
});

test('the preview switch’s buttons are at least 24 px each way', () => {
  const bodies = [
    ...css.matchAll(/(^|\n)\.entity-card__preview-switch button \{([^}]*)\}/g),
  ].map((match) => match[2]);
  const sized = bodies.filter((body) => /\bheight:/.test(body));
  assert.ok(sized.length, 'the switch buttons have a size');
  for (const body of sized) {
    assert.ok(Number(body.match(/\bheight:\s*(\d+)px/)[1]) >= 24, body);
    assert.ok(Number(body.match(/\bwidth:\s*(\d+)px/)[1]) >= 24, body);
  }
});
