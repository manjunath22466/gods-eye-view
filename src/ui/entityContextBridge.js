import { ref, shallowRef, watch } from 'vue';
import { resolvePickedContext } from '../data/pickedContext.js';
import { isStreetViewerExpanded } from './streetLevelViewerPlacement.js';
import { CCTV_SELECTED_EVENT } from './cctvEvents.js';
import { ESCAPE_OWNING_DIALOGS } from './contextEvents.js';
import {
  STREET_LEVEL_LAYER,
  STREET_LEVEL_PHOTO_EVENT,
  STREET_LEVEL_PHOTO_REQUEST_EVENT,
  streetLevelCardKey,
} from './streetLevelEvents.js';
import { onScreen } from '../data/locate.js';
import { clickCard } from '../data/pickRegistry.js';
import {
  followedOf,
  isFollowing,
  onFollowChanged,
  stopFollowing,
} from '../data/followed.js';
import { fromDegreesInto } from '../geo/ellipsoid.js';
import { inputFor } from '../input/dispatcher.js';
import {
  isTrackingClickGesture,
  isTrackingSelectionGesture,
} from '../data/trackingClickGesture.js';
import { applicationHooksOf } from '../render/applicationHooks.js';
import { findCamera, findGlobe, rendererOf } from '../render/rendererOf.js';
import { WORLD_FOCUS_FRAMING } from '../worldFocus.js';
import { heightsOf } from '../queries/heights.js';
import { t } from '../i18n/index.js';
import { useCockpitStore } from './stores/cockpit.js';
import { useDockedStore } from './stores/docked.js';
import { isGlobeView, useEntityCardStore } from './stores/entityCard.js';
import { useOmnibarStore } from './stores/omnibar.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import { useSceneStore } from './stores/scenes.js';
import { useSpaceMissionsStore } from './stores/spaceMissions.js';
import {
  MOBILE_SHEET_ATTR,
  isContextRailCovered,
  isContextSurfaceVisible,
} from './mobileSheets.js';
import { useVoiceStore } from './stores/voice.js';
import { inspectorHasLayers } from './layerRowState.js';
import { createViewWeather } from './viewWeather.js';

/** Camera distance (m) that frames an item of each kind. */
const FRAME_RANGE = Object.freeze({
  aircraft: 30_000,
  vessel: 9_000,
  satellite: 2_500_000,
  earthquake: 120_000,
  storm: 1_500_000,
  fire: 20_000,
  'fire perimeter': 40_000,
  'road segment': 3_000,
});
const DEFAULT_RANGE = 8_000;
/**
 * Items the camera can follow: their layers follow through the camera port
 * with a key naming the item (src/data/followed.js). A vessel is flown to.
 */
const FOLLOWABLE = new Set(['flights', 'military', 'satellites']);

/**
 * Connects the Context panel's entity card to the globe: a click on anything a
 * layer can identify opens its card, and the card's actions fly to it, follow
 * it or ask GEV about it. Layers keep their own click behaviour; this listens
 * alongside them.
 * @param {object} options
 * @param {object} options.viewer Cesium viewer.
 * @param {() => object} options.getDataManager Layer lifecycle.
 * @param {object} options.pinia
 * @param {(viewer: object, x: number, y: number) => ({lat: number, lon: number}|null)} [options.pickWorld]
 *   The ground under a normalized screen point; the view's centre falls back
 *   to the point under the camera without it.
 * @param {(lat: number, lon: number, options?: {signal?: AbortSignal}) => Promise<object>} [options.regionalBrief]
 *   Provides weather for selected cards and is the Inspector's fallback
 *   when no point-weather adapter is supplied.
 * @param {(lat: number, lon: number, options?: {signal?: AbortSignal}) => Promise<object>} [options.spotWeather]
 *   The weather-only service for the unselected view.
 * @param {(fly: () => void) => unknown} [options.navigateToSelection] Hand an explicit row flight to the navigation owner.
 * @param {object} [options.inspector] The Inspector count owner and optional weather clock.
 * @param {() => void} [options.revealContext] Reveal Context on the mobile shell.
 * @param {() => void} [options.supersedeDeferredNavigation] Retire older navigation before a card's explicit flight.
 * @param {() => void} [options.creditAirports] Show the OurAirports credit once an airport's card opens.
 * @returns {() => void} disconnects
 */
export function installEntityContext({
  viewer,
  getDataManager,
  pinia,
  pickWorld,
  regionalBrief,
  spotWeather,
  inspector,
  navigateToSelection,
  revealContext,
  exitContextSelectionView,
  supersedeDeferredNavigation,
  creditAirports,
}) {
  const store = useEntityCardStore(pinia);
  const omnibar = useOmnibarStore(pinia);
  const voice = useVoiceStore(pinia);
  const docked = useDockedStore(pinia);
  const cockpitStore = useCockpitStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const scenes = useSceneStore(pinia);
  /** Whether Context is open. (readView also reads while the Omnibar is focused.) */
  const isOpen = () =>
    chrome.panels['global-context-panel']?.collapsed === false;
  const doc = globalThis.document;
  const contextShown = () => isOpen() && isContextSurfaceVisible(doc?.body);
  let disposed = false;
  let dockedCardPick = null;
  // The renderer's camera; looked up on use, as a renderer can be bound
  // after Context is installed.
  const camera = () => findCamera(viewer);
  /** Whether the camera follows this card's item (the follow's key). */
  const followsCard = (card, followed = followedOf(viewer)) => {
    const key = followed?.key;
    if (!key || !card) return false;
    return key === card.key || key === `${card.layerId}:${card.identity?.id}`;
  };
  const inCockpit = () =>
    Boolean(doc?.body?.classList.contains('cockpit-mode'));

  /**
   * Show Context: its rail item, and on a phone its sheet unless `reveal`
   * is false (a camera stepped to from the Cameras sheet keeps that sheet,
   * where its Next and Previous are).
   */
  function openPanel({ reveal = true } = {}) {
    if (reveal && exitContextSelectionView?.() === false) return;
    const button = doc?.querySelector(
      '.ui-rail--right .ui-rail__item[data-rail-item="global-context-panel"]',
    );
    // The store updates before the rail's aria-pressed value renders.
    if (!isOpen() && button && button.getAttribute('aria-pressed') !== 'true')
      button.click();
    if (reveal) revealContext?.();
  }

  function revealCurrentCard() {
    openPanel();
    globalThis.dispatchEvent?.(new Event('gev:context-show-view'));
  }

  function flyTo(card, { explicit = false, fromSelection = false } = {}) {
    const manager = getDataManager();
    const layer = manager?.layers?.get?.(card?.layerId)?.module;
    const id = card?.identity?.id;
    if (card?.layerId === 'cctv') {
      if (inCockpit()) return 'cockpit-active';
      if (isFollowing(viewer)) return 'tracking-holds-view';
      // Live cards use the camera layer's focus policy and framing. With
      // the layer off, the card flies to its saved location without waking
      // the layer.
      if (manager?.isEnabled?.('cctv')) {
        const result = layer?.focusCamera?.(id);
        if (result != null && result !== 'no-active-camera') {
          if (explicit && result === 'focused') supersedeDeferredNavigation?.();
          return result;
        }
      }
    }
    const enabled = manager?.isEnabled?.(card?.layerId);
    const canFocusTrain =
      enabled && card.layerId === 'rail' && layer?.focusTrain;
    if (enabled && card.layerId === 'ais-live-vessels') layer?.selectById?.(id);
    if (enabled && card.layerId === 'transit') layer?.focusVehicle?.(id);
    const port = camera();
    const canFrame =
      port && Number.isFinite(card?.lat) && Number.isFinite(card?.lon);
    if (!canFocusTrain && !canFrame) return;
    const height = card.pinHeightM ?? card.altitudeM ?? 0;
    const framing = card.obscured ? WORLD_FOCUS_FRAMING['sighting-area'] : null;
    const pitch = framing?.pitchDeg ?? (card.kind === 'satellite' ? -90 : -45);
    const range = framing?.rangeM ?? FRAME_RANGE[card.kind] ?? DEFAULT_RANGE;
    const fly = () => {
      // Moving trains take the camera through their layer; missing ones use the saved fix.
      if (canFocusTrain && layer.focusTrain(id)) return true;
      if (!canFrame) return;
      port.flyToBounds(
        {
          center: fromDegreesInto(card.lon, card.lat, Math.max(0, height), {
            x: 0,
            y: 0,
            z: 0,
          }),
          radius: framing?.radiusM ?? 1,
        },
        {
          offset: {
            heading: port.pose().heading,
            pitch: (pitch * Math.PI) / 180,
            range,
          },
          durationS: 2,
        },
      );
      return true;
    };
    if ((fromSelection || (canFocusTrain && explicit)) && navigateToSelection) {
      return navigateToSelection(fly) !== false;
    }
    if (explicit) supersedeDeferredNavigation?.();
    return fly();
  }

  function follow(card) {
    const run = omnibar.runner;
    if (!run || !FOLLOWABLE.has(card.layerId)) return flyTo(card);
    Promise.resolve(
      run('track_entity', {
        query: card.identity.id || card.title,
        layerId: card.layerId,
      }),
    ).catch(() => {});
  }

  // Closing the card lets go of the camera, when the camera follows the
  // card's own item and nothing else took it over since.
  function letGo(card) {
    if (!followsCard(card)) return;
    // Only the card's own layer lets go, as the person's own action; other
    // layers' selections stay as they are.
    const layer = getDataManager()?.layers?.get?.(card.layerId);
    try {
      if (card.layerId === 'rail') stopFollowing(viewer);
      else layer?.module?.stopTracking?.({ origin: 'user' });
    } catch {
      // A layer going away meanwhile has nothing left to let go of.
    }
  }

  // An item back in its feed after it left it is selected again in its layer,
  // as the click that picked it: a vessel is highlighted with its trail, and
  // an aircraft found again (`follow`) is followed.
  function reselect(card, { follow: andFollow = false } = {}) {
    const layer = getDataManager()?.layers?.get?.(card?.layerId)?.module;
    const id = card?.identity?.id;
    if (!layer || !id) return;
    try {
      if (card.layerId === 'ais-live-vessels') layer?.selectById?.(id);
      else if (andFollow && FOLLOWABLE.has(card.layerId)) follow(card);
    } catch {
      // A layer going away meanwhile has nothing to select.
    }
  }

  // Aircraft can be flown from, and a satellite ridden in the orbital view:
  // track the craft, then enter Cockpit on it. Only layers the tracking
  // action can follow are offered (local ADS-B cannot be tracked).
  const COCKPIT_LAYERS = new Set(['flights', 'military', 'satellites']);
  // Only a satellite whose class can be ridden offers the orbital view
  // (debris cannot); the satellites layer says, by NORAD id.
  function satelliteRideable(card) {
    const layer = getDataManager()?.layers?.get?.('satellites');
    try {
      return layer?.module?.cockpitEnterable?.(card.identity?.id) === true;
    } catch {
      return false;
    }
  }
  async function cockpit(card) {
    try {
      await enterCockpit(card);
    } catch {
      // The craft left the feed or tracking failed; the card stays as it is.
    }
  }
  // Anything else that moves has its own first-person view (a vessel's
  // bridge, a train's or a bus's cab) once its layer says the picked item can
  // be entered: the same check the entry itself makes.
  function rideOffered(card) {
    const presence = cockpitStore.presence;
    return Boolean(
      presence?.entryAvailable &&
      presence.entryLayerId &&
      presence.entryLayerId === card?.layerId &&
      presence.entryId === String(card?.identity?.id),
    );
  }
  async function enterCockpit(card) {
    const run = omnibar.runner;
    if (!COCKPIT_LAYERS.has(card.layerId)) {
      if (rideOffered(card)) cockpitStore.act('enter', card.identity);
      return;
    }
    if (!run) return;
    const generation = store.selectionGeneration();
    const tracked = await run('track_entity', {
      query: card.identity.id || card.title,
      layerId: card.layerId,
    });
    const isCurrent = () =>
      !disposed &&
      store.card?.key === card.key &&
      store.selectionGeneration() === generation;
    if (tracked?.ok !== true || !isCurrent()) return;
    if (card.layerId !== 'satellites') {
      cockpitStore.act('enter', card.identity);
      return;
    }
    // A satellite is ridden through the app's own Cockpit entry, which offers
    // the orbital view once the satellite is tracked. Wait for it to say so;
    // if it never does (a class that cannot be ridden), nothing is entered.
    for (let tries = 0; tries < 40; tries++) {
      // Another pick or a closed card in the meantime calls the ride off.
      if (!isCurrent()) return;
      const presence = cockpitStore.presence;
      if (
        presence?.entryAvailable &&
        presence.entryKind === 'satellite' &&
        presence.entryId === String(card.identity.id)
      ) {
        cockpitStore.act('enter', card.identity);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  function askText(prompt, reference) {
    voice.controls?.emit('chat-restore');
    voice.controls?.emit(
      'chat-prompt',
      reference ? { text: prompt, reference } : prompt,
    );
    voice.controls?.emit('chat-submit');
  }

  // The card's Ask icon opens the Chat with the item already attached; the
  // person writes the question.
  function ask(card, title = card.title) {
    voice.controls?.emit('chat-restore');
    voice.controls?.emit('chat-item', {
      key: card.key,
      name: title,
      itemKind: card.kind,
      layer: card.layerName,
      ...(!store.locationWithheld && {
        lat: card.lat,
        lon: card.lon,
        obscured: card.obscured,
      }),
    });
  }

  // A pinned view: back to the camera as it was, its position and its
  // heading, pitch and roll.
  function flyToPose(pose) {
    const port = camera();
    if (!port || ![pose?.lat, pose?.lon, pose?.height].every(Number.isFinite))
      return;
    const fly = () =>
      port.flyTo(
        { lon: pose.lon, lat: pose.lat, height: pose.height },
        {
          orientation: {
            heading: pose.heading || 0,
            pitch: Number.isFinite(pose.pitch) ? pose.pitch : -Math.PI / 2,
            roll: pose.roll || 0,
          },
          durationS: 2,
        },
      );
    if (navigateToSelection) return navigateToSelection(fly);
    supersedeDeferredNavigation?.();
    return fly();
  }

  /** Dock a street-level photo in place of the docked one. */
  function dockStreetPhoto(identity) {
    const found = store.describe(identity);
    const title =
      !found || found.titleWords ? t('Street-level photo') : found.title;
    docked.dock({
      key: streetLevelCardKey(identity.id),
      kind: 'street',
      icon: found?.icon || 'streetview',
      title,
      identity,
    });
  }

  store.connect({
    dataManager: getDataManager,
    creditAirports,
    openPanel,
    flyTo,
    flyToPose,
    follow,
    letGo,
    reselect,
    // Whether the camera shows the card's item; null when it cannot tell.
    onScreen: (card) => {
      const pose = camera()?.pose();
      if (!pose || !Number.isFinite(card?.lat) || !Number.isFinite(card?.lon))
        return null;
      return onScreen(
        pose,
        card.lat,
        card.lon,
        card.pinHeightM ?? card.altitudeM ?? 0,
      );
    },
    isOpen,
    replaceDockedPhoto(identity, { fromPin }) {
      const current = docked.view;
      if (current?.kind !== 'street' || current.identity.id === identity.id)
        return;
      const layer = getDataManager()?.layers?.get('street-level')?.module;
      if (docked.stowed || layer?.dockedPhotoAdmission?.()?.() === false)
        return false;
      if (!layer?.hasDockedPhoto?.()) return;
      // The restore already announces itself and keeps ownership of the card.
      if (layer.dockedPhotoRestoring?.()) return false;
      const pick = {
        id: identity.id,
        fromPin,
        generation: store.selectionGeneration(),
      };
      dockedCardPick = pick;
      const clearPick = () => {
        if (dockedCardPick === pick) dockedCardPick = null;
      };
      layer.openPhoto(identity.id, { frame: true }).then(clearPick, clearPick);
      return true;
    },
    regionalBrief,
    spotWeather,
    // The renderer's card previews, when it has them.
    previews: () => applicationHooksOf(rendererOf(viewer)).cardPreviews ?? null,
    ask,
    askText,
    cockpit,
    canCockpit: (card) =>
      !store.layerOff(card?.layerId) &&
      (COCKPIT_LAYERS.has(card?.layerId)
        ? Boolean(omnibar.runner) &&
          (card.layerId !== 'satellites' || satelliteRideable(card))
        : rideOffered(card)),
    canFollow: (card, { auto = false } = {}) =>
      FOLLOWABLE.has(card?.layerId) &&
      !store.layerOff(card.layerId) &&
      (!auto || Boolean(omnibar.runner)),
    // Where the camera is, so a search prefers what is close by.
    here: () => {
      const pose = camera()?.pose();
      return pose && Number.isFinite(pose.lat) && Number.isFinite(pose.lon)
        ? { lat: pose.lat, lon: pose.lon }
        : null;
    },
  });

  // What the camera shows, for the Context panel to describe when nothing is
  // picked: the ground under the middle of the screen, the view's bounds and
  // the height. Read when the camera settles, not every frame. `settled` is
  // false for a read taken while the camera is still moving.
  let hasCameraSnapshot = false;
  const motionPending = ref(false);
  let groundPoint = null;
  let groundRead = 0;
  const usableHeight = (height) =>
    Number.isFinite(height) && height > -500 && height < 9000;
  function readGround(settled) {
    const read = ++groundRead;
    if (!groundPoint) return null;
    const heights = heightsOf(viewer);
    const sampled = heights.now(groundPoint, { against: 'terrain' });
    if (sampled !== 0) return usableHeight(sampled) ? sampled : null;
    // The ellipsoid also reports zero. At a settled point, ask for a sample
    // that distinguishes measured sea level from the ellipsoid fallback.
    if (settled && isOpen()) {
      heights
        .batch([groundPoint], { against: 'terrain', ellipsoidMisses: true })
        .then(([height]) => {
          if (
            disposed ||
            read !== groundRead ||
            motionPending.value ||
            !isOpen() ||
            !store.view ||
            !usableHeight(height) ||
            store.view.groundM === height
          )
            return;
          store.setView({ ...store.view, groundM: height });
        })
        .catch(() => {});
    }
    return null;
  }
  const readView = ({ settled = !moving && quiet === null } = {}) => {
    const port = camera();
    if (!port || (!isOpen() && doc?.activeElement?.id !== 'gev-omnibar-input'))
      return;
    const pose = port.pose();
    // An invalid pose keeps the previous snapshot and leaves the motion fence set.
    if (![pose.lat, pose.lon, pose.height].every(Number.isFinite)) return;
    const middle = pickWorld?.(viewer, 0.5, 0.5);
    const corners = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ].map(([x, y]) => pickWorld?.(viewer, x, y));
    const center = middle
      ? { lat: middle.lat, lon: middle.lon }
      : { lat: pose.lat, lon: pose.lon };
    const footprint = port.viewRectangle();
    const rect = footprint ?? {
      west: -180,
      south: -90,
      east: 180,
      north: 90,
    };
    groundPoint = middle ? center : null;
    hasCameraSnapshot = true;
    store.setView(
      {
        center,
        rect,
        groundFootprint: footprint != null || middle != null,
        corners: corners.every(Boolean)
          ? corners.map(({ lat, lon }) => ({ lat, lon }))
          : null,
        heightM: pose.height,
        groundM: readGround(settled),
        // Horizon tests use the camera position even when the view is tilted.
        eye: { lat: pose.lat, lon: pose.lon },
        // Keep the camera's orientation so the view can be pinned.
        pose: {
          lon: pose.lon,
          lat: pose.lat,
          height: pose.height,
          heading: pose.heading,
          pitch: pose.pitch,
          roll: pose.roll,
        },
      },
      { settled },
    );
    // Release the weather motion fence only after a valid settled snapshot.
    if (settled) motionPending.value = false;
  };
  let lastRead = 0;
  let trailing = null;
  let quiet = null;
  let moving = false;
  const stopQuiet = () => {
    clearTimeout(quiet);
    quiet = null;
  };
  const onChanged = () => {
    motionPending.value = true;
    clearTimeout(trailing);
    stopQuiet();
    // A view jump can settle without moveEnd. An ongoing move needs moveEnd.
    if (!moving) {
      quiet = setTimeout(() => {
        quiet = null;
        readView();
      }, 1200);
    }
    // Following and panning publish at most once a second while moving.
    const now = performance.now();
    if (now - lastRead >= 1000) {
      lastRead = now;
      readView({ settled: false });
      return;
    }
    trailing = setTimeout(
      () => {
        lastRead = performance.now();
        readView({ settled: false });
      },
      1000 - (now - lastRead),
    );
  };
  let cameraOff = [];
  const listen = () => {
    const port = camera();
    if (!port || cameraOff.length) return;
    cameraOff = [
      port.on('moveStart', () => {
        moving = true;
        motionPending.value = true;
        stopQuiet();
        readView();
      }),
      port.on('moveEnd', () => {
        moving = false;
        motionPending.value = true;
        clearTimeout(trailing);
        stopQuiet();
        readView();
      }),
      port.on('changed', onChanged),
    ];
    const globe = findGlobe(viewer);
    if (globe?.on) {
      let pending = globe.isSettled?.('terrain') === false;
      let version = globe.surfaceVersion?.();
      cameraOff.push(
        globe.on('progress', ({ terrainPending }) => {
          const nextVersion = globe.surfaceVersion?.();
          const changed =
            nextVersion !== version || (pending && terrainPending === 0);
          pending = terrainPending > 0;
          version = nextVersion;
          if (
            !changed ||
            !groundPoint ||
            motionPending.value ||
            !isOpen() ||
            !store.view
          )
            return;
          const groundM = readGround(true);
          if (groundM !== store.view.groundM)
            store.setView({ ...store.view, groundM });
        }),
      );
    }
  };
  listen();
  const firstRead = setTimeout(() => {
    listen();
    readView();
  }, 0);
  // The Omnibar's nearby suggestions also need a fresh center even with
  // Context closed. Its focus event requests one camera read.
  const onSearchFocus = (event) => {
    if (event.target?.id === 'gev-omnibar-input') readView();
  };
  doc?.addEventListener('focusin', onSearchFocus);
  // Opening the panel describes the view as it is now.
  let wasOpen = isOpen();
  const offChrome = chrome.$subscribe(() => {
    const open = isOpen();
    if (open && !wasOpen) readView();
    wasOpen = open;
  });

  const stopInspectorWatchers = [];
  let weather;
  if (inspector) {
    const missions = useSpaceMissionsStore(pinia);
    const shown = () => store.inspector.shown;
    const mountId = () => store.inspector.mountId;
    const manager = () => {
      // A replacement can reveal a new registry without a feed update.
      void store.managerVersion;
      return getDataManager?.() ?? null;
    };
    const globe = () => isGlobeView(store.view);
    const countInputs = [
      shown,
      () => store.layerRevision,
      () => missions.enabled,
      () => store.inspectorPulse,
    ];
    const metadataInputs = [...countInputs, manager, globe];
    const metadataReady = ref(false);
    const countSample = shallowRef(null);
    let appliedSample = { inputs: metadataInputs.map((read) => read()) };
    const readCurrentInput = () => ({
      center: hasCameraSnapshot && !globe() ? store.view?.center : null,
      moving: motionPending.value,
      shown: store.readViewContextShown(),
      mountId: mountId(),
    });
    store.publishInspectorRows([]);
    store.publishViewWeather(null);
    weather = createViewWeather({
      ...inspector.weatherClock,
      read: store.readWeather,
      readCurrentInput,
      publish: store.publishViewWeather,
    });

    stopInspectorWatchers.push(
      watch(
        countSample,
        (sample) => {
          // Finish the current flush before admitting a count request: a
          // post-flush callback can still replace the manager or view.
          queueMicrotask(() => {
            if (
              disposed ||
              !sample ||
              sample !== countSample.value ||
              sample === appliedSample
            )
              return;
            const { inputs, rows } = sample;
            const live = metadataInputs.map((read) => read());
            if (inputs[countInputs.length] !== live[countInputs.length]) {
              store.syncDataManager();
              return;
            }
            if (inputs.some((value, index) => value !== live[index])) return;
            const [visible, , missionsEnabled] = inputs;
            appliedSample = sample;
            if (!visible || !store.readViewContextShown()) {
              inspector.counts.update({ shown: false, nothingOn: false });
              return;
            }
            inspector.counts.update({
              shown: true,
              nothingOn: !inspectorHasLayers(rows, missionsEnabled),
            });
          });
        },
        { flush: 'post' },
      ),
      // Render and focus recovery use one pre-flush sample. A globe-only
      // refresh updates suggestions without admitting counts.
      watch(
        [metadataReady, ...metadataInputs],
        ([, ...inputs], [initialized, ...previous]) => {
          const rows = inputs[0] ? store.allLayers() : [];
          if (inputs[0]) store.publishInspectorRows(rows);
          const pending =
            countSample.value && countSample.value !== appliedSample;
          if (
            !initialized ||
            pending ||
            inputs
              .slice(0, countInputs.length)
              .some((value, index) => value !== previous[index])
          )
            countSample.value = { inputs, rows };
        },
      ),
      watch(
        [
          shown,
          mountId,
          () => store.view,
          motionPending,
          () => store.inspectorPulse,
        ],
        (current, previous) => {
          const input = readCurrentInput();
          weather.update(input);
          if (
            input.shown &&
            previous.length &&
            current.at(-1) !== previous.at(-1)
          )
            weather.pulse();
        },
        { immediate: true, flush: 'post' },
      ),
    );
    // Let a manager attached later in setup join the first pre-flush sample.
    metadataReady.value = true;
  }

  /** Layers whose own map click already follows what was clicked. */
  const CLICK_FOLLOWS = new Set(['flights', 'military', 'satellites']);

  // Keep the card's "following" in step with the camera: it says Following
  // while the camera follows the card's own item (the follow's key names
  // it) and not otherwise, whoever started or ended the follow. A layer
  // switching what it follows lets go for a moment and takes hold again in
  // the same turn, so this is checked once that settles.
  let followCheck = 0;
  const offFollow = onFollowChanged(viewer, () => {
    clearTimeout(followCheck);
    const card = store.card;
    // Taking hold of the card's item shows at once; letting go waits a
    // moment, in case the layer is only switching follows.
    if (followsCard(card)) {
      store.following = card.key;
      return;
    }
    followCheck = setTimeout(() => {
      const now = store.card;
      store.following = followsCard(now) ? now.key : null;
    }, 250);
  });

  // A click on anything a layer can identify opens its card. The input
  // dispatcher hands every subscriber the same click, picked once before
  // any layer acts on it, and only while no tool holds the pointer.
  const offClick = inputFor(viewer).onClick((event) => {
    // Cockpit has its own picks, and Context is hidden while it runs. A
    // camera drag never selects, even if it ends over something.
    if (inCockpit() || !isTrackingSelectionGesture(event.gesture)) return;
    // A card or label painted on top is its layer's click, read once per
    // click so every layer agrees: Context names nothing under it and keeps
    // its own card as it is.
    const claimed = clickCard(event);
    if (claimed) {
      // A click on the current item's own label reveals it without a new
      // selection. A feed refreshing the same item has no click to reveal.
      if (
        store.card &&
        claimed.sourceId === store.card.layerId &&
        claimed.entryId === store.card.identity?.id
      )
        revealCurrentCard();
      return;
    }
    const identity = resolvePickedContext(event.hit, {
      dataManager: getDataManager(),
    });
    if (identity) {
      // Street Level owns the pick. Open its card when it has a photo, not
      // from the raw line or cone id while the viewer is still loading.
      if (identity.layerId === STREET_LEVEL_LAYER) return;
      // These layers start following on their own click; following again
      // from here would fight them (the flights layer reads a second track
      // of the same plane as a click on empty map and lets go).
      const picked =
        identity.layerId === 'ais-live-vessels'
          ? { ...identity, vesselId: identity.id }
          : identity;
      store.select(picked, { follow: !CLICK_FOLLOWS.has(identity.layerId) });
      return;
    }
    // A click on open ground, sea or sky lets go of what was selected. A
    // click on something else Context cannot describe (a label, a trail)
    // leaves the card as it is.
    // Only a clean click lets go, as the layers' own clicks do; Context then
    // describes the view (its place header pins the view itself).
    if (event.surface && isTrackingClickGesture(event.gesture)) store.clear();
  });

  // A camera pick shows its feed in Context. Its tools stay on the Properties tab.
  // Picking the camera already on the card brings Context and its view tab forward.
  const onCameraPicked = ({ detail }) => {
    const id = detail?.cameraId;
    if (!id || inCockpit()) return;
    // On a phone, a step made in the Cameras sheet (its Next or Previous, or
    // voice while it is shown) keeps that sheet up; the card is there when
    // the person turns to Context.
    const inCamerasSheet =
      doc?.body?.getAttribute?.(MOBILE_SHEET_ATTR) === 'cameras';
    if (store.card?.layerId === 'cctv' && store.card.identity?.id === id) {
      if (!inCamerasSheet) revealCurrentCard();
      return;
    }
    store.select(
      { layerId: 'cctv', id: String(id) },
      { reveal: !inCamerasSheet },
    );
  };
  doc?.addEventListener(CCTV_SELECTED_EVENT, onCameraPicked);

  // An accepted photo pick reveals its card. Viewer steps advance their
  // existing card without changing the visible panel or phone sheet.
  let photoRequest = null;
  // The generation of the bridge's own last photo card.
  let photoCardGeneration = null;
  const onStreetPhotoRequest = ({ detail }) => {
    photoRequest = {
      id: detail.requestId,
      cover: detail.cover,
      generation: store.selectionGeneration(),
      ownsPick: store.claimDeferredPick(),
    };
  };
  const onStreetPhoto = ({ detail }) => {
    const id = detail?.id;
    if (!id || inCockpit()) return;
    const requestId = detail.requestId;
    const requestGeneration =
      requestId != null &&
      photoRequest?.id === requestId &&
      photoRequest.ownsPick()
        ? photoRequest.generation
        : null;
    const key = streetLevelCardKey(id);
    const identity = {
      layerId: STREET_LEVEL_LAYER,
      id: String(id),
      lat: detail.lat,
      lon: detail.lon,
    };
    const priorDock = docked.view?.kind === 'street' ? docked.view : null;
    if (priorDock && priorDock.key !== key) dockStreetPhoto(identity);
    // The card shows on the Inspector tab, not behind Properties.
    const showInspector = () =>
      globalThis.dispatchEvent?.(
        new CustomEvent('gev:context-show-view', { detail: { inspect: true } }),
      );
    // The person selected a different surface while a row OPEN was pending.
    if (detail.revealFromOpen === false) return;
    if (
      detail.revealFromOpen === true &&
      !doc?.body?.classList.contains('ui-embed')
    ) {
      if (requestGeneration !== store.selectionGeneration()) return;
      const reveal = !contextShown();
      if (store.card?.key === key) {
        if (reveal) openPanel();
      } else if (!store.select(identity, { reveal })) return;
      showInspector();
      photoCardGeneration = store.selectionGeneration();
      return;
    }
    // A voice request to show Street Level names the photo already open:
    // its card comes up while Context is on screen.
    if (detail.explicit === true) {
      if (contextShown()) {
        showInspector();
        if (
          store.card?.key !== key &&
          store.select(identity, { reveal: false })
        )
          photoCardGeneration = store.selectionGeneration();
      }
      return;
    }
    if (priorDock) {
      if (priorDock.key === key) return;
      if (
        dockedCardPick?.generation === store.selectionGeneration() &&
        dockedCardPick.id === detail.cardPhotoId
      ) {
        store.select(identity, {
          fromPin: dockedCardPick.fromPin,
          follow: false,
        });
        photoCardGeneration = store.selectionGeneration();
        return;
      }
      if (store.card?.key !== priorDock.key) return;
      if (requestId == null) {
        if (store.advance(identity))
          photoCardGeneration = store.selectionGeneration();
        return;
      }
    }
    const now = store.selectionGeneration();
    if (requestId == null) {
      if (store.card?.key === key) {
        if (isContextSurfaceVisible(doc?.body)) photoCardGeneration = now;
      } else if (
        store.card?.layerId === STREET_LEVEL_LAYER &&
        photoCardGeneration === now
      ) {
        store.advance(identity);
      }
      return;
    }
    if (
      requestGeneration != null &&
      detail.cardPhotoId &&
      store.card?.key === streetLevelCardKey(detail.cardPhotoId)
    ) {
      if (store.card.key === key || store.advance(identity))
        photoCardGeneration = now;
      return;
    }
    if (requestGeneration !== now) return;
    if (
      isContextRailCovered(doc?.body) &&
      exitContextSelectionView?.(photoRequest.cover) !== true
    )
      return;
    const reveal = !contextShown();
    if (store.card?.key === key) {
      if (reveal) openPanel();
    } else if (!store.select(identity, { reveal })) return;
    showInspector();
    photoCardGeneration = store.selectionGeneration();
  };
  doc?.addEventListener(STREET_LEVEL_PHOTO_REQUEST_EVENT, onStreetPhotoRequest);
  doc?.addEventListener(STREET_LEVEL_PHOTO_EVENT, onStreetPhoto);

  // Layers that select through the context store (GeoJSON sites, fires,
  // installations) announce it; their selection opens the card too.
  const onSelected = ({ detail: record }) => {
    if (!record?.layerId || inCockpit()) return;
    const vesselId =
      record.layerId === 'ais-live-vessels'
        ? record.properties?.vesselId
        : null;

    const id = vesselId ? String(vesselId) : record.id;
    // A layer can echo a card selection. Keep pin ownership and Back history.
    if (
      store.card?.layerId === record.layerId &&
      store.card.identity?.id === id
    )
      return;
    store.select({
      layerId: record.layerId,
      id,
      ...(vesselId ? { vesselId: String(vesselId) } : {}),
      label: record.label || record.properties?.name,
      lat: record.latitude,
      lon: record.longitude,
    });
  };
  globalThis.addEventListener?.('gev:entity-selected', onSelected);

  // Esc on the map itself (focus on the page or the globe) clears the pick
  // first, as it does inside Context. Every other Esc owner keeps its own:
  // Cockpit, dialogs (a camera's enlarged view among them), a control that
  // takes its own Esc (data-owns-escape), a phone sheet (which closes
  // first), panels and fields. Pins stay until unpinned.
  const onKey = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing)
      return;
    if (!store.card || inCockpit() || scenes.panel?.running || isStreetViewerExpanded()) return;
    const target = event.target;
    if (target?.closest?.('[data-owns-escape], dialog, [role="dialog"]'))
      return;
    const onMap =
      !target ||
      target === doc?.body ||
      target === doc?.documentElement ||
      Boolean(target.closest?.('canvas, .cesium-widget'));
    if (!onMap) return;
    if (doc?.body?.hasAttribute?.('data-mobile-sheet')) return;
    if (doc?.querySelector?.(ESCAPE_OWNING_DIALOGS)) return;
    event.preventDefault();
    store.clear();
  };
  doc?.addEventListener?.('keydown', onKey);

  return () => {
    if (disposed) return;
    disposed = true;
    for (const stop of stopInspectorWatchers) stop();
    weather?.stop();
    inspector?.counts.stop();
    if (inspector) {
      store.publishInspectorRows([]);
      store.publishViewWeather(null);
    }
    clearTimeout(firstRead);
    offClick();
    for (const off of cameraOff) off?.();
    clearTimeout(trailing);
    clearTimeout(quiet);
    offFollow();
    offChrome();
    doc?.removeEventListener('focusin', onSearchFocus);
    clearTimeout(followCheck);
    globalThis.removeEventListener?.('gev:entity-selected', onSelected);
    doc?.removeEventListener?.(CCTV_SELECTED_EVENT, onCameraPicked);
    doc?.removeEventListener?.(STREET_LEVEL_PHOTO_EVENT, onStreetPhoto);
    doc?.removeEventListener?.(
      STREET_LEVEL_PHOTO_REQUEST_EVENT,
      onStreetPhotoRequest,
    );
    doc?.removeEventListener?.('keydown', onKey);
    store.connect(null);
  };
}
