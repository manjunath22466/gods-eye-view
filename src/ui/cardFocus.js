import { nextTick } from 'vue';

// Keyboard focus across a card change in Context: the control that switched
// cards (an airport link, Back) goes away with its card, and focus would fall
// to the page. It moves to a control on the new card instead, else to that
// card's title.

/**
 * After the card has rendered, focus the first of `selectors` found in it,
 * else its title. A link on the new card may show only once its lookup is
 * in (an airport code), so it is waited for a few turns.
 * @param {string[]} selectors
 * @param {object} store The card store that handled the navigation.
 * @param {{turns?: number}} [options]
 * @returns {Promise<?Element>} What took focus, if anything.
 */
export async function focusInCard(selectors, store, { turns = 20 } = {}) {
  const key = store.card?.key;
  const doc = globalThis.document;
  if (!key || !doc) return null;
  let moved = false;
  const onFocus = () => {
    moved = true;
  };
  doc.addEventListener('focusin', onFocus, true);
  try {
    for (let turn = 0; ; turn++) {
      await nextTick();
      if (moved || store.card?.key !== key) return null;
      const card = doc.getElementById('entity-card');
      if (!card) return null;
      const found = selectors
        .map((selector) => card.querySelector(selector))
        .find(Boolean);
      if (found) {
        found.focus();
        return found;
      }
      if (!selectors.length || turn + 1 >= turns) return focusCardTitle(card);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    doc.removeEventListener('focusin', onFocus, true);
  }
}

/**
 * Focus the card's title, as the place to land when the control that had
 * the focus is gone and nothing on the card stands in for it.
 * @param {?Element} [card]
 * @returns {?Element} The title, if there is one.
 */
export function focusCardTitle(
  card = globalThis.document?.getElementById('entity-card'),
) {
  const title = card?.querySelector('.entity-card__title');
  if (!title) return null;
  title.setAttribute('tabindex', '-1');
  title.focus();
  return title;
}
