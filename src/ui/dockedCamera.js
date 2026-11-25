import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { createCctvVideoSurface } from './cctvVideo.js';
import { captureFrameStill, isBlankFrame } from './frameStill.js';

/**
 * A docked camera's picture, and whether it is live.
 *
 * A video camera plays its own stream. While Cameras is on and it is the
 * active camera, the dock paints from the decoder the map's projection runs
 * (no second connection); once the layer lets that go (Cameras off, Clear
 * all, another camera picked), the dock holds the camera's stream itself, one
 * connection, until it is closed. A stream that cannot go on leaves that
 * camera's last drawn frame, paused, never another picture.
 *
 * A still camera shows its frame, read again on its refresh interval. It is
 * live only once a frame has loaded and is not blank; until then it is
 * loading, and a failed or blank frame says so.
 *
 * While `suspended` (the dock is hidden: under Context's full-height column,
 * or with the corner put away by Cockpit, clean view or recording) nothing
 * runs: no stream of its own, no painter and no frame reads; the
 * dock says 'paused' and starts again when it shows.
 *
 * `feed` is what the dock says: 'live', 'loading', 'stalled', 'paused',
 * 'failed', 'lost' (no frame), or '' when no camera is docked.
 */
export function useDockedCamera({
  view,
  tick,
  cards,
  docked,
  pinned,
  activeFrame,
  cctvLive,
  cctvView,
  suspended = ref(false),
  document = globalThis.document,
}) {
  const cameraId = computed(() =>
    view.value?.kind === 'camera' ? String(view.value.identity?.id || '') : '',
  );
  const key = computed(() => (cameraId.value ? view.value.key : ''));
  const layer = () => cards.layerModule('cctv');

  const pageHidden = ref(Boolean(document?.hidden));
  const onVisibility = () => {
    pageHidden.value = Boolean(document?.hidden);
  };
  document?.addEventListener?.('visibilitychange', onVisibility);

  // The docked camera's stream, held from when it is first known: its URL
  // carries a time stamp, so reading it again would restart a playing hold.
  const stream = shallowRef(null);
  const ownFailed = ref(false);
  watch(
    [tick, key],
    ([, next], [, was]) => {
      if (next !== was) {
        stream.value = null;
        ownFailed.value = false;
      }
      if (!cameraId.value || stream.value) return;
      stream.value = layer()?.streamSourceForCamera?.(cameraId.value) || null;
    },
    { immediate: true },
  );

  const shared = computed(
    () =>
      Boolean(cameraId.value) &&
      Boolean(cctvLive.value) &&
      cctvView.value?.activeCameraId === cameraId.value,
  );
  // The map has the stream again: the dock's own hold may try again later.
  watch(shared, (isShared) => isShared && (ownFailed.value = false));
  const streamMode = computed(() => {
    if (!cameraId.value) return '';
    if (shared.value) return 'shared';
    return stream.value && !ownFailed.value ? 'own' : '';
  });

  // The dock's own hold on the stream, only while the map's is not there.
  const ownVideo = shallowRef(null);
  let hold = null;
  function release() {
    hold?.dispose();
    hold = null;
    ownVideo.value = null;
  }
  watch(
    [() => streamMode.value === 'own', pageHidden, stream, key, suspended],
    ([own, hidden, source, , away]) => {
      release();
      if (!own || hidden || away || !source || !document?.createElement) return;
      const video = document.createElement('video');
      let handle = null;
      handle =
        layer()?.attachCameraStream?.(video, source, {
          onFailure: () => {
            if (!handle || hold !== handle) return;
            release();
            ownFailed.value = true;
          },
        }) || null;
      if (!handle) {
        ownFailed.value = true;
        return;
      }
      hold = handle;
      ownVideo.value = video;
    },
    { immediate: true },
  );

  // One painter for the dock's canvas, whichever decoder it reads: a handover
  // keeps the last frame drawn while the next one starts.
  const canvas = ref(null);
  const streamState = ref('');
  const streamOn = computed(() => streamMode.value !== '');
  let surface = null;
  // Whether this painter has drawn anything yet (it keeps it over a handover).
  const everDrawn = ref(false);
  function stopPainter() {
    surface?.stop();
    surface = null;
    streamState.value = '';
    everDrawn.value = false;
  }
  watch(
    [streamOn, canvas, pageHidden, key, suspended],
    ([on, element, hidden, , away]) => {
      stopPainter();
      if (!on || !element || hidden || away) return;
      const own = createCctvVideoSurface(
        element,
        () =>
          streamMode.value === 'shared'
            ? layer()?.getActiveVideoElement?.() || null
            : ownVideo.value,
        {
          clearOnSwitch: false,
          onState: (next) => {
            if (surface !== own) return;
            streamState.value = next;
            if (next === 'playing') everDrawn.value = true;
          },
        },
      );
      surface = own;
      streamState.value = 'waiting';
    },
    { flush: 'post', immediate: true },
  );
  const streamDrawn = computed(
    () => streamState.value === 'playing' || streamState.value === 'stalled',
  );

  // Each real frame the dock shows is kept small: the camera's pin shows it
  // while docked, and it is the last frame shown once the stream stops or
  // the dock closes with the layer off. A blank frame is never kept.
  async function keepFrom(shown) {
    const current = view.value;
    if (current?.kind !== 'camera' || !shown || isBlankFrame(shown)) return;
    const url = await captureFrameStill({ shown, url: '' });
    if (!url || view.value?.key !== current.key) return;
    docked.keepStill(current.key, url);
    pinned.setStill(current.key, url);
  }
  let streamStillAt = 0;
  function keepStreamStill(fresh = false) {
    // A stalled picture is the frame already kept; nothing new to save.
    if (streamState.value !== 'playing' || !canvas.value) return;
    const refreshMs = cards.cameraDetails(cameraId.value)?.refreshMs || 10_000;
    if (!fresh && Date.now() - streamStillAt < refreshMs) return;
    streamStillAt = Date.now();
    void keepFrom(canvas.value);
  }
  watch(streamDrawn, (isDrawn) => isDrawn && keepStreamStill(true));

  // A still camera's frame, read again once its refresh interval has
  // passed. The frame the camera's card last showed (the camera store) is
  // only the first picture: docked, the card no longer refreshes it, so the
  // dock reads its own from then on. A video camera that is not playing
  // shows only its own last frame.
  const still = ref('');
  const stillState = ref('');
  let stillAt = 0;
  watch(
    [tick, key],
    ([, next], [, was]) => {
      if (next !== was) stillState.value = '';
      if (!cameraId.value) {
        still.value = '';
        return;
      }
      // Hidden (stowed, a mode that hides the corner, or a background tab):
      // the picture shown last stays; nothing is read meanwhile.
      if (suspended.value || pageHidden.value) {
        if (next !== was) still.value = docked.lastStillOf(next);
        return;
      }
      if (streamOn.value) {
        // On a new camera the canvas still holds the previous camera's frame
        // until its painter restarts; that camera's first drawn frame is
        // kept instead (the streamDrawn watcher).
        if (next === was) keepStreamStill();
        still.value = '';
        return;
      }
      if (stream.value) {
        still.value = docked.lastStillOf(next);
        return;
      }
      if (next !== was) {
        const fromCard =
          activeFrame.value?.cameraId === cameraId.value
            ? activeFrame.value.src || activeFrame.value.currentSrc
            : '';
        still.value = fromCard || docked.lastStillOf(next);
        if (fromCard) {
          stillAt = Date.now();
          return;
        }
      }
      const frame = cards.cameraFrame(cameraId.value);
      // The camera dropped out of its feed: no stale frame passed off as live.
      if (!frame) {
        still.value = '';
        return;
      }
      if (next !== was || Date.now() - stillAt >= frame.refreshMs) {
        still.value = frame.url;
        stillAt = Date.now();
      }
    },
    { immediate: true },
  );
  // Shown again: the next read fetches a fresh frame.
  watch(
    [suspended, pageHidden],
    ([away, hidden]) => away || hidden || (stillAt = 0),
  );
  // A stream that stops leaves its last frame at once, not on the next read.
  watch(streamOn, (on) => {
    if (on) still.value = '';
    else if (stream.value) still.value = docked.lastStillOf(key.value);
  });
  // A new frame is loading until it loads; one already shown stays live
  // while the next one loads in its place.
  watch(still, (src) => {
    if (!src) stillState.value = '';
    else if (stillState.value !== 'ok') stillState.value = 'loading';
  });
  function stillLoaded(event) {
    const image = event?.target;
    if (stream.value) return;
    if (isBlankFrame(image)) {
      stillState.value = 'failed';
      return;
    }
    stillState.value = 'ok';
    void keepFrom(image);
  }
  function stillFailed() {
    if (!stream.value) stillState.value = 'failed';
  }

  const feed = computed(() => {
    if (!cameraId.value) return '';
    if (suspended.value) return 'paused';
    if (streamOn.value) {
      if (streamState.value === 'playing') return 'live';
      return streamState.value === 'stalled' ? 'stalled' : 'loading';
    }
    if (stream.value) return still.value ? 'paused' : 'lost';
    if (!still.value) return 'lost';
    if (stillState.value === 'ok') return 'live';
    return stillState.value === 'failed' ? 'failed' : 'loading';
  });
  /** Whether a picture is drawn under the dock's label. */
  const pictured = computed(() => {
    if (streamOn.value) return everDrawn.value;
    if (stream.value) return Boolean(still.value);
    return Boolean(still.value) && stillState.value === 'ok';
  });

  onBeforeUnmount(() => {
    stopPainter();
    release();
    document?.removeEventListener?.('visibilitychange', onVisibility);
  });

  return {
    canvas,
    streamOn,
    still,
    stillLoaded,
    stillFailed,
    feed,
    pictured,
  };
}
