/**
 * Sent on the document when a place is picked: a place row or
 * chip in search, or a voice request that names a place. Only these open a
 * place's card. `detail: {name, latitude?, longitude?, query?}`.
 */
export const PLACE_PICK_EVENT = 'gev:place-pick';

/**
 * Open dialogs that keep Esc for themselves: while one is open, Context and
 * the map leave Esc alone. A popup that takes its own Esc is marked
 * data-owns-escape (a camera's enlarged view, CctvPreview.vue).
 */
export const ESCAPE_OWNING_DIALOGS =
  'dialog[open], [aria-modal="true"], [role="dialog"][data-owns-escape]';
