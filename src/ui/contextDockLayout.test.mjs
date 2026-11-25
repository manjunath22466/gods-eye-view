// The expanded Context column starts below the top-right row, so the
// Stories button and the ACTIVE STYLE readout never draw over its header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const px = (css, pattern, what) => {
  const found = css.match(pattern);
  assert.ok(found, `${what} is set`);
  return Number(found[1]);
};

test('the expanded Context column starts below the Stories button and the style readout', () => {
  const dock = read('./styles/context-dock.css');
  const foundation = read('./styles/foundation.css');
  const stories = read('./styles/stories-entry.css');
  const dockTop = px(dock, /--context-dock-top:\s*(\d+)px/, 'the column top');
  const rule =
    dock.match(/body\.context-docked #right-context-rail \{([^}]*)\}/)?.[1] ||
    '';
  assert.match(rule, /top:\s*var\(--context-dock-top\)/, 'the column uses it');
  assert.match(
    rule,
    /height:\s*calc\(100vh - var\(--context-dock-top\)\)/,
    'and fills the rest of the height',
  );
  // The row sits 32px down (the readout's top, which the Stories button
  // lines up with) and the Stories button is 36px tall.
  const rowTop = px(
    foundation,
    /#style-indicator \{[^}]*?top:\s*(\d+)px/,
    'the readout top',
  );
  const storiesHeight = px(
    stories,
    /#gev-stories \.gs-entry \{[^}]*?height:\s*(\d+)px/,
    'the Stories height',
  );
  assert.ok(
    dockTop >= rowTop + storiesHeight + 8,
    `column top ${dockTop}px clears the row (${rowTop + storiesHeight}px)`,
  );
});

// Expanded, the column keeps its size and the panel keeps its own glass,
// border, radius and glow, as the other panels have.
test('the expanded panel keeps its usual look', () => {
  const dock = read('./styles/context-dock.css');
  const inner =
    dock.match(
      /body\.context-docked #global-context-panel \.global-context-panel-inner \{([^}]*)\}/,
    )?.[1] ?? '';
  assert.match(inner, /height:\s*100%/);
  for (const prop of ['background', 'border', 'border-radius', 'box-shadow'])
    assert.doesNotMatch(
      inner,
      new RegExp(`(^|[;\\s])${prop}:`),
      `no ${prop} of its own`,
    );
  assert.doesNotMatch(
    dock,
    /body\.context-docked #global-context-panel \.panel-glow/,
    'its glow stays',
  );
});
