import { t } from '../i18n/index.js';
import { SINCE_STOPS } from './streetLevelPresentation.js';

/**
 * The Street Level row's controls in Data Layers: its imagery sources as
 * chips, the panorama filter and the SINCE window, the coverage line and
 * OPEN for a source with no lines to click. The filters belong to the layer,
 * as Rail's type chips do (left = layers, right = information); a photo's
 * card in Context shows what a picked image is. Pure, so it is testable.
 * @param {object|null} view The presented layer (`presentStreetLevelPanel`).
 * @param {{toggleProvider: (id: string) => void, openNearest: () => void}} handlers
 * @returns {object|null} The row controls (layerPanel.js `_presentControls`).
 */
export function streetLevelRowControls(view, handlers) {
  if (!view) return null;
  const chips = view.providers.map((provider) => ({
    id: `sl-provider-${provider.id}`,
    label: provider.label,
    title: provider.title,
    color: provider.color || undefined,
    active: provider.active,
    busy: provider.busy,
    disabled: false,
    state: provider.state,
    onClick: () => handlers.toggleProvider(provider.id),
  }));
  if (view.nearest.visible)
    chips.push({
      id: 'sl-open-nearest',
      label: view.nearest.label,
      title: view.nearest.title,
      action: true,
      disabled: Boolean(view.nearest.disabled),
      state: 'idle',
      onClick: () => handlers.openNearest(),
    });
  const filtersOff = Boolean(view.controlsDisabled);
  const pano = view.filter.pano || 'all';
  const segmented = view.filterControls.pano
    ? {
        id: 'sl-pano',
        label: t('IMAGERY'),
        ariaLabel: t('Panorama filter'),
        options: [
          ['all', t('ALL')],
          ['pano', '360°'],
          ['flat', t('FLAT')],
        ].map(([value, label]) => ({
          id: `sl-pano-${value}`,
          label,
          active: pano === value,
          disabled: filtersOff,
          params: { pano: value },
        })),
      }
    : null;
  const since = view.since;
  const slider = view.filterControls.since
    ? {
        id: 'sl-since',
        label: t('SINCE'),
        ariaLabel: t('SINCE'),
        min: 0,
        max: SINCE_STOPS.length - 1,
        step: 1,
        value: since.index,
        valueText: view.sinceNote
          ? `${since.label} ${view.sinceNote}`
          : since.label,
        params: (stop) => ({
          sinceDays: SINCE_STOPS[Number(stop)]?.days ?? 0,
        }),
      }
    : null;
  return {
    chips,
    segmented,
    // A missing key gates the filters only: the chips stay, so their tips
    // can say how to add the key.
    slider: filtersOff ? null : slider,
    info: view.error || view.meta || '',
  };
}
