export const MOBILE_SHELL_CLASS = 'mobile-shell';
export const MOBILE_SHEET_ATTR = 'data-mobile-sheet';

/**
 * Panels each sheet expands. A sheet also shows its rail's other panels
 * collapsed (Scenes under Layers), per styles/mobile-shell.css.
 */
export const MOBILE_SHEET_PANELS = Object.freeze({
  layers: Object.freeze(['data-panel']),
  // Street-level photos open their cards in Context.
  cameras: Object.freeze(['cctv-panel']),
  context: Object.freeze(['global-context-panel']),
  missions: Object.freeze(['space-missions-panel']),
  search: Object.freeze(['location-bar']),
  more: Object.freeze(['control-panel', 'pp-toggles']),
});

/**
 * @param {string} panelId
 * @returns {string|null} The sheet that presents `panelId`.
 */
export function sheetForPanelId(panelId) {
  for (const [sheet, ids] of Object.entries(MOBILE_SHEET_PANELS)) {
    if (ids.includes(panelId)) return sheet;
  }
  return null;
}

/** Body modes that obscure the Context rail while leaving its disclosure open. */
export function isContextRailModeCovered(body = globalThis.document?.body) {
  return Boolean(
    body?.classList.contains('ui-clean-view') ||
    body?.classList.contains('recording-mode') ||
    body?.classList.contains('stories-mode') ||
    body?.classList.contains('ui-embed'),
  );
}

/** Whether a body mode or the event panel covers the Context rail. */
export function isContextRailCovered(body = globalThis.document?.body) {
  return (
    isContextRailModeCovered(body) ||
    Boolean(body?.querySelector?.('#right-context-rail.bhote-event-active'))
  );
}

/** Whether the rail is available on the current desktop or phone surface. */
export function isContextSurfaceVisible(body = globalThis.document?.body) {
  return (
    !isContextRailCovered(body) &&
    (!body?.classList.contains(MOBILE_SHELL_CLASS) ||
      body.getAttribute(MOBILE_SHEET_ATTR) === 'context')
  );
}
