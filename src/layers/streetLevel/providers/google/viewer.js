import {
  DETAILS_RETRY_COOLDOWN_MS,
  DETAILS_TIMEOUT_MS,
  GOOGLE_PROVIDER_ID,
  KEY_REJECTED_MESSAGE,
  NO_ANSWER_MESSAGE,
  OPEN_TIMEOUT_MS,
  creatorFrom,
  imageDateMs,
  streetViewUrl,
} from './policy.js';
import { msg } from '../../../../i18n/index.js';

const PANORAMA_OPTIONS = Object.freeze({
  visible: false,
  // The caption has the address; Google's card covers a docked panorama.
  addressControl: false,
  linksControl: true,
  panControl: true,
  zoomControl: true,
  clickToGo: true,
  showRoadLabels: true,
  // The panel has EXPAND and ×.
  fullscreenControl: false,
  enableCloseButton: false,
  motionTracking: false,
  motionTrackingControl: false,
});

/**
 * Viewer adapter over Google's StreetViewPanorama: emits a pose for every
 * panorama and view change, including steps along Google's arrows.
 * @param {{loader: ReturnType<import('./mapsLoader.js').createMapsLoader>, getService?: () => Promise<object>, render?: object}} options
 * @returns {import('../../registry.js').ViewerAdapter & {remember: Function}}
 */
export function createGoogleViewer({ loader, getService, render } = {}) {
  let library = null;
  let panorama = null;
  let element = null;
  let host = null;
  let service = null;
  let opening = null;
  let active = false;
  let confirmed = null;
  let walkPosition = null;
  /** Bumped by `unmount`: a construction it overtook builds nothing. */
  let generation = 0;
  let subscriptions = [];
  const described = new Map();
  /** Panorama id → its lookup in flight; a late answer to a dropped one is ignored. */
  const lookingUp = new Map();
  const retryAfter = new Map();
  const listeners = new Set();

  function requestRender() {
    render?.governorRequestRender?.('google-street-view');
  }

  async function ensureLibrary() {
    library ||= await loader.importLibrary('streetView');
    return library;
  }

  function emit(pose) {
    for (const listener of [...listeners]) {
      try {
        listener(pose);
      } catch {
        /* listener errors are the core's to log */
      }
    }
  }

  function metaFrom(data) {
    return {
      capturedAt: imageDateMs(data?.imageDate),
      creator: creatorFrom(data?.copyright),
      title: data?.location?.description || null,
    };
  }

  /**
   * Look up a panorama's date, photographer and address once, then re-emit
   * the pose. A failed or timed-out lookup can retry after the cooldown.
   */
  async function describe(panoId) {
    if (described.has(panoId) || lookingUp.has(panoId)) return;
    if (Date.now() < (retryAfter.get(panoId) ?? 0)) return;
    const lookup = { timer: null };
    lookingUp.set(panoId, lookup);
    const current = () => lookingUp.get(panoId) === lookup;
    try {
      const { data } = await new Promise((resolve, reject) => {
        lookup.timer = setTimeout(
          () => reject(new Error(NO_ANSWER_MESSAGE)),
          DETAILS_TIMEOUT_MS,
        );
        (async () => {
          service ||= getService
            ? await getService()
            : new (await ensureLibrary()).StreetViewService();
          if (!current())
            throw new Error('Street View details lookup was released');
          return service.getPanorama({ pano: panoId });
        })().then(resolve, reject);
      });
      if (!current()) return;
      described.set(panoId, metaFrom(data));
      retryAfter.delete(panoId);
    } catch {
      if (current())
        retryAfter.set(panoId, Date.now() + DETAILS_RETRY_COOLDOWN_MS);
      return;
    } finally {
      clearTimeout(lookup.timer);
      if (current()) lookingUp.delete(panoId);
    }
    publishPose();
  }

  function releaseLookups() {
    for (const lookup of lookingUp.values()) clearTimeout(lookup.timer);
    lookingUp.clear();
  }

  function selectedPanorama(instance) {
    const id = instance.getPano();
    const location = instance.getLocation?.();
    if (location?.pano && location.pano !== id) return null;
    const coordinates = location?.latLng ?? instance.getPosition();
    const lat = coordinates?.lat();
    const lon = coordinates?.lng();
    return id && Number.isFinite(lat) && Number.isFinite(lon)
      ? { id, position: { lat, lon } }
      : null;
  }

  function publishPose() {
    if (
      !active ||
      opening ||
      !confirmed ||
      panorama?.getPano() !== confirmed.id ||
      panorama.getStatus() !== 'OK'
    )
      return;
    const { id: panoId, position } = confirmed;
    const meta = described.get(panoId);
    if (!meta) describe(panoId);
    const pov = panorama.getPov() || {};
    emit({
      providerId: GOOGLE_PROVIDER_ID,
      imageId: panoId,
      position,
      bearing: Number.isFinite(pov.heading) ? pov.heading : null,
      tilt: Number.isFinite(pov.pitch) ? pov.pitch : 0,
      altitude: null,
      isPano: true,
      capturedAt: meta?.capturedAt ?? null,
      capturedAtPrecision: 'month',
      creator: meta?.creator ?? null,
      title: meta?.title ?? null,
      sequenceId: null,
      externalUrl: streetViewUrl(panoId, {
        heading: pov.heading || 0,
        pitch: pov.pitch || 0,
      }),
    });
    requestRender();
  }

  function publishWalk(instance) {
    if (
      walkPosition &&
      instance.getPano() === walkPosition.id &&
      instance.getStatus() === 'OK'
    ) {
      confirmed = walkPosition;
      walkPosition = null;
      publishPose();
    }
  }

  async function ensurePanorama(target) {
    if (panorama && host === target) return panorama;
    const built = generation;
    const { StreetViewPanorama } = await ensureLibrary();
    if (built !== generation) throw new Error('Street View was unmounted');
    if (panorama && host === target) return panorama;
    destroyPanorama();
    element = target.ownerDocument.createElement('div');
    element.className = 'sl-google-panorama';
    element.style.cssText = 'position:absolute;inset:0;';
    target.append(element);
    host = target;
    const instance = new StreetViewPanorama(element, PANORAMA_OPTIONS);
    panorama = instance;
    // The ID can change before its position arrives. POV and status alone
    // may refresh a confirmed panorama but cannot establish a new one.
    subscriptions = [
      instance.addListener('position_changed', () => {
        if (panorama !== instance || !active || opening || !confirmed) return;
        walkPosition = selectedPanorama(instance);
        publishWalk(instance);
      }),
      instance.addListener('status_changed', () => {
        if (panorama === instance && active && !opening) publishWalk(instance);
      }),
      instance.addListener('pov_changed', publishPose),
    ];
    return instance;
  }

  function destroyPanorama() {
    opening?.cancel?.();
    opening = null;
    active = false;
    confirmed = null;
    walkPosition = null;
    for (const subscription of subscriptions) subscription.remove();
    subscriptions = [];
    try {
      panorama?.setVisible(false);
    } catch {
      /* already gone */
    }
    element?.remove();
    panorama = null;
    element = null;
    host = null;
  }

  /** Wait for a current panorama ID, position and successful status. */
  function showPanorama(instance, request) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(reject, new Error(NO_ANSWER_MESSAGE)),
        OPEN_TIMEOUT_MS,
      );
      const stopAuthWatch = loader.onAuthFailure(() =>
        finish(reject, new Error(KEY_REJECTED_MESSAGE)),
      );
      request.cancel = () => finish(resolve);
      let position = null;
      function accept() {
        if (
          opening === request &&
          position &&
          instance.getPano() === position.id &&
          instance.getStatus() === 'OK' &&
          (position.id === request.id || !request.superseded.has(position.id))
        )
          finish(resolve, position);
      }
      const subscriptions = [
        instance.addListener('position_changed', () => {
          position = selectedPanorama(instance);
          accept();
        }),
        instance.addListener('status_changed', () => {
          if (opening !== request) return;
          const status = instance.getStatus();
          if (status === 'OK') accept();
          else if (status && instance.getPano() === request.id)
            finish(
              reject,
              new Error(msg('Street View has no imagery for this place')),
            );
        }),
      ];
      function finish(settle, value) {
        request.cancel = null;
        clearTimeout(timer);
        for (const subscription of subscriptions) subscription.remove();
        stopAuthWatch();
        settle(value);
      }
      try {
        instance.setPano(request.id);
        instance.setVisible(true);
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  return {
    async mount(target) {
      if (!target) throw new Error('Street Level viewer has no host element');
      await ensurePanorama(target);
    },

    async open(imageId) {
      const id = String(imageId);
      if (!host) throw new Error('Street View is not mounted');
      if (loader.authFailed()) throw new Error(KEY_REJECTED_MESSAGE);
      const prior = opening;
      const request = { id, superseded: prior?.superseded ?? new Set() };
      if (prior) request.superseded.add(prior.id);
      // The panorama already shown can still report its position while the
      // SDK loads a replacement. That event does not confirm the new open.
      if (confirmed) request.superseded.add(confirmed.id);
      opening = request;
      prior?.cancel?.();
      walkPosition = null;
      try {
        const instance = await ensurePanorama(host);
        if (opening !== request) return;
        let selection;
        if (
          confirmed?.id === id &&
          instance.getPano() === id &&
          instance.getStatus() === 'OK'
        ) {
          instance.setVisible(true);
          selection = confirmed;
        } else {
          // A replacement can change the SDK's display before it reports
          // whether it succeeded. A failed load leaves no confirmed pose.
          if (confirmed) {
            confirmed = null;
            emit(null);
          }
          if (opening !== request) return;
          selection = await showPanorama(instance, request);
        }
        if (opening !== request) return;
        if (
          !selection ||
          instance.getPano() !== selection.id ||
          instance.getStatus() !== 'OK'
        )
          throw new Error(NO_ANSWER_MESSAGE);
        confirmed = selection;
        active = true;
        opening = null;
        publishPose();
        return selection.id;
      } finally {
        if (opening === request) opening = null;
      }
    },

    close() {
      opening?.cancel?.();
      opening = null;
      active = false;
      walkPosition = null;
      try {
        panorama?.setVisible(false);
      } catch {
        /* torn down */
      }
    },

    unmount() {
      releaseLookups();
      generation++;
      destroyPanorama();
    },

    resize() {
      if (!panorama) return;
      try {
        globalThis.google?.maps?.event?.trigger(panorama, 'resize');
      } catch {
        /* no-op */
      }
    },

    onPose(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Seed the details cache from a nearest lookup's answer. */
    remember(panoId, data) {
      if (panoId && data) described.set(String(panoId), metaFrom(data));
    },
  };
}
