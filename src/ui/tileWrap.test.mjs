// src/ui/tileWrap.test.mjs — count and figure tiles: a long name or value
// wraps to a second line instead of being cut short, and the tiles in a row
// stay one height. The test DOM has no layout, so the stylesheet is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(
  new URL('./styles/entity-card.css', import.meta.url),
  'utf8',
);
const card = fs.readFileSync(
  new URL('./views/panels/EntityCard.vue', import.meta.url),
  'utf8',
);

/** Every declaration block whose selector list is exactly `selector`. */
function rules(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    ...css.matchAll(
      new RegExp(
        `(?:^|})\\s*(?:/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*/\\s*)*${escaped}\\s*\\{([^}]*)\\}`,
        'g',
      ),
    ),
  ].map(([, body]) => body);
}

function wrapsToTwoLines(selector) {
  const bodies = rules(selector);
  assert.ok(bodies.length, `${selector} has a rule`);
  const all = bodies.join('\n');
  assert.doesNotMatch(
    all,
    /white-space:\s*nowrap/,
    `${selector} is not held on one line`,
  );
  assert.match(
    all,
    /-webkit-line-clamp:\s*2/,
    `${selector} wraps to two lines at most`,
  );
  assert.match(
    all,
    /display:\s*-webkit-box/,
    `${selector} is a box the clamp applies to`,
  );
}

test("Context's count tiles: a long layer name wraps to two lines", () => {
  wrapsToTwoLines('.view-context__tile-name > span:last-child');
});

test("a card's figure tiles: a long value wraps to two lines and keeps its full text as a title", () => {
  wrapsToTwoLines('.entity-card__tile strong');
  // The card's own rule must not turn the value back into a one-line flex row.
  for (const body of rules('#entity-card .entity-card__tile strong'))
    assert.doesNotMatch(body, /display:/);
  assert.match(
    card,
    /class="entity-card__tile" :title="/,
    'the tile carries its value as a title',
  );
});

test('tiles in a row are one height, their figures lined up', () => {
  // Grid rows stretch their items; nothing may set the tiles to their own height.
  for (const selector of ['.view-context__tile', '.entity-card__tile'])
    for (const body of rules(selector))
      assert.doesNotMatch(body, /align-self:|height:/, selector);
  assert.match(
    rules('.view-context__tile strong').join('\n'),
    /margin-top:\s*auto/,
    'facts sit at the foot of their tiles',
  );
  assert.match(
    rules(
      '.view-context__tiles:not(.view-context__tiles--facts) .view-context__tile strong',
    ).join('\n'),
    /margin-top:\s*0/,
    'a count sits under its name, with no gap above it',
  );
  assert.match(
    rules('.entity-card__tile').join('\n'),
    /align-content:\s*space-between/,
    'values sit at the foot of their tiles',
  );
});
