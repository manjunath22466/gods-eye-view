import { t, translateKnown } from '../i18n/index.js';

/**
 * The credit a street-level photo's picture carries wherever it shows
 * without its viewer (its card's still): its provider's credit, as
 * the globe shows it while the provider is on, then who took it and under
 * what licence, as the open photo's caption names them
 * (streetLevelPresentation.js). Without the provider's credit, its name, as
 * the photo's card names its source.
 * @param {object|null|undefined} module The Street Level layer's module.
 * @param {string} id The photo's id (`<providerId>:<imageId>`).
 * @returns {string} Empty when no source is known.
 */
export function streetPhotoCredit(module, id) {
  const record = module?.photo?.(id) || null;
  // A photo's id is `<providerId>:<imageId>` (layers/streetLevel/photos.js).
  const providerId =
    record?.providerId || String(id ?? '').split(':', 1)[0] || '';
  const source =
    (providerId && module?.providerCredit?.(providerId)) ||
    (record?.provider ? translateKnown(record.provider) : '');
  if (!source) return '';
  const parts = [source];
  if (record?.creator)
    parts.push(t('Image by {creator}', { creator: record.creator }));
  if (record?.license) parts.push(record.license);
  return parts.join(' · ');
}
