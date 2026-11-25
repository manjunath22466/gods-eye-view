import { t, translateKnown } from '../i18n/index.js';

export function streetPhotoAttribution({ creator, via, license } = {}) {
  const attribution = [];
  if (creator) attribution.push(t('Image by {creator}', { creator }));
  else if (via) attribution.push(t('via {source}', { source: via }));
  if (license) attribution.push(license);
  return attribution;
}

/**
 * Credit a still with its provider, creator and licence.
 * @param {object|null|undefined} module The Street Level layer's module.
 * @param {string} id The photo's id (`<providerId>:<imageId>`).
 * @returns {string} Empty when no source is known.
 */
export function streetPhotoCredit(module, id) {
  const record = module?.photo?.(id) || null;
  const providerId =
    record?.providerId || String(id ?? '').split(':', 1)[0] || '';
  const source =
    (providerId && module?.providerCredit?.(providerId)) ||
    (record?.provider ? translateKnown(record.provider) : '');
  if (!source) return '';
  return [source, ...streetPhotoAttribution(record || undefined)].join(' · ');
}
