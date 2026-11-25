/**
 * Sent on the document when a street-level photo opens or the viewer moves on
 * to another image (a click on the map, OPEN, voice, a walk through the
 * photo): Context shows that photo's card when it is on screen or already
 * shows a photo's card (see entityContextBridge.js). Its detail carries the
 * photo identity, position and request id (null for a viewer step),
 * the id being `<providerId>:<imageId>` (layers/streetLevel/photos.js).
 */
export const STREET_LEVEL_PHOTO_EVENT = 'gev:street-level-photo';

/**
 * Sent on the document when Street Level starts loading a photo, before its
 * STREET_LEVEL_PHOTO_EVENT. The request id in detail ties the later photo
 * to the selection at the start of that load.
 */
export const STREET_LEVEL_PHOTO_REQUEST_EVENT =
  'gev:street-level-photo-request';

/** The layer a street-level photo's card belongs to. */
export const STREET_LEVEL_LAYER = 'street-level';

/** The card key of a street-level photo id. */
export const streetLevelCardKey = (id) =>
  id ? `${STREET_LEVEL_LAYER}:${id}` : '';
