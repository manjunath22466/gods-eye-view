import { presentStreetLevelPanel } from './streetLevelPresentation.js';
import { streetLevelRowControls } from './streetLevelRowControls.js';
import { useStreetLevelStore } from './stores/streetLevel.js';
import { placeStreetLevelViewer } from './streetLevelViewerPlacement.js';
import { applicationPinia } from './vueRuntime.js';
import { onLocaleChange, t, translateKnown } from '../i18n/index.js';
import { MOBILE_SHEET_ATTR } from './mobileSheets.js';

const RENDER_MODE_KEY = 'gev:street-level:render-mode';
/** <body> classes of the modes that hide every panel; an expanded photo leaves with them. */
const PANEL_HIDING_MODES = ['ui-clean-view', 'recording-mode', 'cockpit-mode'];

/** True on an embedded page (`?embed=1` or the inline panel). */
function isEmbedPage() {
  return globalThis.document?.body?.classList?.contains('ui-embed') === true;
}

/**
 * Drives Street Level's UI: the photo viewer on its card in Context
 * (StreetLevelViewer.vue, `gev-street-level` store) and the provider chips
 * and filters on its Data Layers row (streetLevelRowControls.js). An open
 * photo, and each image the viewer moves on to, is announced through
 * `actions.showPhoto`, so Context can show its card. The standalone Street
 * Level panel is retired.
 */
export class StreetLevelControls {
  constructor({
    root,
    layer,
    actions,
    store = useStreetLevelStore(applicationPinia()),
  }) {
    this.root = root;
    this.layer = layer;
    this.actions = actions;
    this.store = store;
    this._storeToken = store.attach({
      setRenderMode: (mode) => {
        this.layer.setViewerRenderMode?.(mode);
        try {
          localStorage.setItem(RENDER_MODE_KEY, mode);
        } catch {
          /* storage unavailable */
        }
      },
      cancelDockedPhoto: () => this.layer.cancelDockedPhoto?.(),
      /** Close the photo whose card went away, unless another took over. */
      closePhoto: (id, options) => this.layer.closePhoto?.(id, options),
      /** Stop a playing sequence: the photo is out of sight. */
      stopPlayback: () => this.layer.stopPlayback?.(),
      /** Open a remembered photo again (its card was picked from a list). */
      openPhoto: (id) => this.layer.openPhoto?.(id, { frame: false }),
    });
    this.destroyed = false;
    this.listeners = new AbortController();
    this._unsubscribe = null;
    this._state = null;
    this._view = null;
    this._wasOpen = false;
    this._photoRequests = 0;
    this._publishedPhotoRevision = 0;
    this._rowOpen = null;
    this._resizeQueued = false;
    this._elements = this._collect();
    this._bind();
    // The presentation holds translated text; present it again in a new locale.
    this._offLocale = onLocaleChange(() => {
      if (this._state) this.render(this._state);
    });
  }

  _collect() {
    // Context moves the viewer out of this root into its own home
    // (streetLevelViewerPlacement.js), possibly before the controls start,
    // so an element missing from the root is looked up on the page.
    const byId = (id) =>
      this.root?.querySelector(`#${id}`) ||
      this.root?.ownerDocument?.getElementById(id) ||
      null;
    return {
      viewerWrap: byId('sl-viewer-wrap'),
      viewerExpand: byId('sl-viewer-expand'),
      viewer: byId('sl-viewer'),
    };
  }

  listen(target, type, handler, options = {}) {
    target?.addEventListener(type, handler, {
      ...options,
      signal: this.listeners.signal,
    });
  }

  _bind() {
    const el = this._elements;
    if (!this.root) return;
    this.layer.attachViewerHost?.(el.viewer);
    // The Data Layers row's filters, presented from the latest state.
    this.layer.presentRowControls?.(() =>
      streetLevelRowControls(this._view, {
        toggleProvider: (id) => this._toggleProvider(id),
        openNearest: () => this._openNearest(),
      }),
    );
    // EXPAND is the browser's fullscreen. iPhone Safari has no element
    // fullscreen, so there it is a top-layer popover; with neither, no button.
    this._expandMode =
      typeof el.viewerWrap?.requestFullscreen === 'function'
        ? 'fullscreen'
        : typeof el.viewerWrap?.showPopover === 'function'
          ? 'popover'
          : null;
    this._popoverOpen = false;
    if (this._expandMode) {
      this.listen(el.viewerExpand, 'click', () => this._toggleExpanded());
      if (this._expandMode === 'fullscreen')
        this.listen(document, 'fullscreenchange', () => this._syncExpanded());
      else
        this.listen(el.viewerWrap, 'toggle', (event) =>
          this._onPopoverToggle(event),
        );
      // Esc shrinks the photo before Context's own Esc can close its card,
      // in a browser that hands the key to the page while full screen too.
      this.listen(el.viewerWrap, 'keydown', (event) => {
        if (event.key !== 'Escape' || !this.isViewerExpanded()) return;
        event.preventDefault();
        event.stopPropagation();
        this._exitExpanded();
      });
    }
    this.store.setExpandAvailable(Boolean(this._expandMode));
    // Embed mode: Esc closes an open photo, since the rail it would go back to
    // is hidden. Full screen keeps its own Esc (above), which leaves it first.
    this.listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape' || !this._embedHome || this.isViewerExpanded())
        return;
      event.preventDefault();
      event.stopPropagation();
      this.layer.closeViewer?.();
    });
    try {
      const stored = localStorage.getItem(RENDER_MODE_KEY);
      if (stored === 'fill' || stored === 'letterbox')
        this.layer.setViewerRenderMode?.(stored);
    } catch {
      /* storage unavailable */
    }
    // MapillaryJS only tracks window resizes; the card resizes on its own.
    if (typeof ResizeObserver === 'function' && el.viewer) {
      this._resizeObserver = new ResizeObserver(() => this._requestResize());
      this._resizeObserver.observe(el.viewer);
    }
  }

  /**
   * Refit the viewer once per frame. Skips a hidden (0×0) viewer, which would
   * ask for tiles at z=NaN; the observer fires again once it has a size.
   */
  _requestResize() {
    if (this._resizeQueued) return;
    this._resizeQueued = true;
    requestAnimationFrame(() => {
      this._resizeQueued = false;
      const viewer = this._elements.viewer;
      if (this.destroyed) return;
      if (viewer && (viewer.clientWidth === 0 || viewer.clientHeight === 0))
        return;
      this.layer.resizeViewer?.();
    });
  }

  /** OPEN: the nearest image under the screen centre, for keyboard users. */
  async _openNearest() {
    const nearest = this._view?.nearest;
    if (!nearest?.visible || nearest.disabled) return;
    const options = {
      providerIds: nearest.providerIds,
      frame: false,
      aim: 'screen-centre',
    };
    this._endRowOpen();
    if (isEmbedPage() || this.actions.dockedPhoto?.())
      return this.layer.openNearest?.(undefined, options);
    const body = this.root.ownerDocument.body;
    const request = {
      count:
        (this.layer.getUIState?.()?.photoRequests ?? this._photoRequests) + 1,
      sheet: body.getAttribute(MOBILE_SHEET_ATTR),
      surfaceChanged: false,
    };
    this._rowOpen = request;
    try {
      request.stopWatching = this.actions.watchContextSurface?.(() => {
        request.surfaceChanged = true;
      });
      const opened = await this.layer.openNearest?.(undefined, options);
      const state = this.layer.getUIState?.() ?? this._state;
      const photo = state?.acceptedPhoto;
      if (
        opened !== true ||
        this.destroyed ||
        this._rowOpen !== request ||
        this._photoRequests !== request.count ||
        state?.photoRequests !== request.count ||
        state.enabled !== true ||
        photo?.requestId !== request.count
      )
        return opened;
      this._publishedPhotoRevision = photo.revision;
      this.actions.showPhoto?.(photo, {
        revealFromOpen:
          !request.surfaceChanged &&
          !isEmbedPage() &&
          !this.actions.dockedPhoto?.() &&
          !PANEL_HIDING_MODES.some((mode) => body.classList.contains(mode)) &&
          body.getAttribute(MOBILE_SHEET_ATTR) === request.sheet,
      });
      return opened;
    } finally {
      this._endRowOpen(request);
    }
  }

  _endRowOpen(request = this._rowOpen) {
    if (!request || this._rowOpen !== request) return;
    this._rowOpen = null;
    request.stopWatching?.();
  }

  async _ensureEnabled() {
    if (this.actions.isEnabled?.()) return true;
    try {
      await this.actions.setEnabled?.(true);
    } catch (error) {
      this.actions.showToast?.(
        translateKnown(error?.message || '') ||
          t('Street Level could not start'),
      );
      return false;
    }
    return this.actions.isEnabled?.() === true;
  }

  /**
   * Lighting a chip turns the layer on and darkens the others (one source at
   * a time); darkening the lit one turns the layer off, keeping the provider.
   * A chip whose source lacks its key says how to add it instead.
   */
  async _toggleProvider(providerId) {
    const chip = this._view?.providers.find((entry) => entry.id === providerId);
    if (!chip) return;
    if (chip.state === 'error') {
      if (chip.title) this.actions.showToast?.(chip.title);
      return;
    }
    if (!chip.active) {
      // Every registered provider in one update (those hidden on this map
      // too), so the share link records the swap.
      const ids =
        this.layer.providerIds || this._view.providers.map((entry) => entry.id);
      this._setParams(
        Object.fromEntries(ids.map((id) => [id, id === providerId])),
      );
      await this._ensureEnabled();
      return;
    }
    try {
      await this.actions.setEnabled?.(false);
    } catch (error) {
      this.actions.showToast?.(
        translateKnown(error?.message || '') || t('Street Level toggle failed'),
      );
    }
  }

  /** Through the data manager, so saved state and share links record it. */
  _setParams(params) {
    this.actions.setParams(params, { origin: 'user' });
  }

  /** Whether EXPAND has the viewer full screen (or, on iPhone, open over the page). */
  isViewerExpanded() {
    const wrap = this._elements.viewerWrap;
    if (!wrap) return false;
    return this._expandMode === 'popover'
      ? this._popoverOpen
      : document.fullscreenElement === wrap;
  }

  async _toggleExpanded() {
    const wrap = this._elements.viewerWrap;
    try {
      if (this.isViewerExpanded()) this._exitExpanded();
      else if (this._expandMode === 'fullscreen')
        await wrap.requestFullscreen();
      else {
        // Only while open: a closed popover is hidden even inside the card.
        wrap.popover = 'auto';
        wrap.showPopover();
      }
    } catch {
      /* refused (no user gesture, policy): the card view stays */
    }
  }

  _exitExpanded() {
    if (!this.isViewerExpanded()) return;
    if (this._expandMode === 'popover') this._elements.viewerWrap.hidePopover();
    else document.exitFullscreen().catch(() => {});
  }

  _onPopoverToggle(event) {
    this._popoverOpen = event.newState === 'open';
    if (!this._popoverOpen)
      this._elements.viewerWrap.removeAttribute('popover');
    this._syncExpanded();
  }

  /** Clean View, recording and the cockpit hide every panel, so they end EXPAND too. */
  _watchPanelHidingModes(on) {
    const body = document.body;
    if (!on || !body) {
      this._modesObserver?.disconnect();
      this._modesObserver = null;
      return;
    }
    // Embed mode keeps Clean View on for its globe while the photo is lifted
    // over it: there only recording and the cockpit end EXPAND.
    const leaveIfHiding = () => {
      if (
        PANEL_HIDING_MODES.some(
          (mode) =>
            body.classList.contains(mode) &&
            !(mode === 'ui-clean-view' && isEmbedPage()),
        )
      )
        this._exitExpanded();
    };
    if (!this._modesObserver && typeof MutationObserver === 'function') {
      this._modesObserver = new MutationObserver(leaveIfHiding);
      this._modesObserver.observe(body, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    leaveIfHiding();
  }

  /** Mirror the expanded state on EXPAND, watch the panel-hiding modes, refit. */
  _syncExpanded() {
    const on = this.isViewerExpanded();
    this._watchPanelHidingModes(on);
    this.store.setExpanded(on);
    this._requestResize();
  }

  /**
   * Embed mode hides the right rail: an open photo moves to <body> as an
   * overlay on the globe (`sl-viewer-wrap-embed`, embed.css) and goes back
   * when it closes. Vue keeps patching the wrap there: its siblings are static.
   */
  _syncEmbedOverlay(open) {
    const wrap = this._elements.viewerWrap;
    if (!wrap || !document.body) return;
    const lift = open === true && isEmbedPage();
    this.store.setEmbedOverlay(lift);
    if (lift && !this._embedHome) {
      this._embedHome = { parent: wrap.parentNode, next: wrap.nextSibling };
      document.body.appendChild(wrap);
      wrap.classList.add('sl-viewer-wrap-embed');
      this._requestResize();
    } else if (!lift && this._embedHome) {
      wrap.classList.remove('sl-viewer-wrap-embed');
      const { parent, next } = this._embedHome;
      this._embedHome = null;
      if (parent?.isConnected)
        parent.insertBefore(wrap, next?.parentNode === parent ? next : null);
      // Then wherever it belongs now: a photo's card, the dock or home.
      placeStreetLevelViewer();
      this._requestResize();
    }
  }

  connect() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    if (this.destroyed || !this.root) return;
    this.layer.attachDockedPhoto?.(
      this.actions.dockedPhoto ?? null,
      this.actions.dockedPhotoCanPresent,
    );
    this._unsubscribe = this.layer.subscribe?.((state) => this.render(state));
    if (this.layer.getUIState) this.render(this.layer.getUIState());
  }

  render(state) {
    if (this.destroyed || !state || !this.root) return;
    this._state = state;
    const view = presentStreetLevelPanel(state);
    this._view = view;
    this._leaveClosedViewer(view);
    this.store.publish(view);
    this._reactToTransitions(view, state);
  }

  /** A closed image leaves EXPAND, and focus stays in Context. */
  _leaveClosedViewer(view) {
    if (view.viewer.open) return;
    this._exitExpanded();
    // A closing image hides the wrap: move focus out first, or it drops to
    // <body>.
    const wrap = this._elements.viewerWrap;
    if (wrap && !wrap.hidden && wrap.contains(document.activeElement))
      this.actions.focusContext?.();
  }

  /** Report the request and its settled photo to the current surface owner. */
  _reactToTransitions(view, state) {
    const open = view.viewer.open;
    if (open && !this._wasOpen) this._requestResize();
    this._wasOpen = open;
    // A new request first, so a card picked after it can keep its place.
    const requests = state.photoRequests ?? 0;
    if (this._rowOpen && requests > this._rowOpen.count) this._endRowOpen();
    if (requests !== this._photoRequests) {
      this._photoRequests = requests;
      if (requests > 0) this.actions.photoRequested?.(requests);
    }
    const photo = state.acceptedPhoto;
    // The row OPEN reports its own accepted photo with the reveal intent.
    const awaitingRowOpen =
      this._rowOpen && photo?.requestId === this._rowOpen.count;
    if (
      photo &&
      photo.revision !== this._publishedPhotoRevision &&
      !awaitingRowOpen
    ) {
      this._publishedPhotoRevision = photo.revision;
      this.actions.showPhoto?.(photo);
    }
    this._syncEmbedOverlay(open);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._endRowOpen();
    this._offLocale();
    this._exitExpanded();
    // Its `toggle` is not heard once destroyed: a popover left on the wrap
    // would hide the viewer even inside the card.
    if (this._expandMode === 'popover')
      this._elements.viewerWrap?.removeAttribute('popover');
    this._watchPanelHidingModes(false);
    this._syncEmbedOverlay(false);
    this.listeners.abort();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.layer.presentRowControls?.(null);
    this.layer.attachDockedPhoto?.(null);
    this.layer.attachViewerHost?.(null);
    this.store.detach(this._storeToken);
  }
}
