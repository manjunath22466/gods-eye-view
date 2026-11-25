const LAYER_ID = 'rocket-launches';

/**
 * The Space Missions layer's wiring. Space Missions is an ordinary layer: the
 * layer owns its data and Satellites dependency, and this connects it to its
 * list, a tab in Context while the layer is on. The list shows when a person
 * turns the layer on (by hand or by voice) or picks a mission on the globe.
 * This wiring switches no layer itself. The layer leaves the person's other
 * layers as they are, apart from Satellites, which it switches on hidden (no
 * dots or orbits) for its orbit data and restores when it turns off
 * (`src/layers/launches/ingestion.js`).
 */
export class SpaceMissionsControls {
  /**
   * @param {object} options
   * @param {?object} options.layer The Space Missions layer.
   * @param {object} options.store The Space Missions store.
   * @param {object} options.actions
   * @param {() => void} options.actions.showMissions Opens Context on the
   *   Missions list (and, on a phone, its sheet).
   * @param {() => boolean} options.actions.isCockpitActive
   */
  constructor({ layer, store, actions }) {
    this._layer = layer || null;
    this._store = store;
    this._actions = actions;
    this._manager = null;
    this._unsubscribeManager = null;
    this.destroyed = false;
    store.connect(this._layer);
    store.publish(null);
    store.setEnabled(false);
    this._unsubscribePanel =
      this._layer?.subscribePanel?.((view) => store.publish(view)) ?? null;
    this._unsubscribeGlobePick =
      this._layer?.subscribeGlobePick?.(() => this._reveal()) ?? null;
  }

  /** Follow a data manager's Space Missions visibility; null disconnects. */
  connect(manager) {
    this._unsubscribeManager?.();
    this._unsubscribeManager = null;
    this._manager = manager || null;
    if (this.destroyed) return;
    this._syncEnabled();
    this._unsubscribeManager =
      this._manager?.subscribe?.((change) => this._handleChange(change)) ??
      null;
  }

  _syncEnabled() {
    this._store.setEnabled(Boolean(this._manager?.isEnabled?.(LAYER_ID)));
  }

  _handleChange(change) {
    if (this.destroyed || change?.layerId !== LAYER_ID) return;
    if (!String(change.type || '').startsWith('visibility')) return;
    this._syncEnabled();
    if (
      change.type === 'visibility' &&
      change.enabled &&
      (change.origin === 'user' || change.origin === 'voice')
    )
      this._reveal();
  }

  /** Open Context on the Missions list, unless the Cockpit owns the screen. */
  _reveal() {
    if (this.destroyed || this._actions.isCockpitActive?.()) return;
    this._actions.showMissions?.();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._unsubscribeManager?.();
    this._unsubscribeManager = null;
    this._unsubscribePanel?.();
    this._unsubscribePanel = null;
    this._unsubscribeGlobePick?.();
    this._unsubscribeGlobePick = null;
    this._store.connect(null);
    this._store.publish(null);
    this._store.setEnabled(false);
  }
}
