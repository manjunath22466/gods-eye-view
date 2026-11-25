import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aircraftCountryCode,
  countryCodeForIcao24,
  countryCodeForName,
  flagEmoji,
} from './aircraftCountry.js';

test('an aircraft’s country comes from its ICAO address block, else its reported origin', () => {
  assert.equal(countryCodeForIcao24('ae1234'), 'US', 'a US military block');
  assert.equal(countryCodeForIcao24('43C6F1'), 'GB');
  assert.equal(
    countryCodeForIcao24('~ae1234'),
    null,
    'a non-ICAO track id has no country',
  );
  assert.equal(countryCodeForIcao24('zz'), null);
  assert.equal(
    countryCodeForIcao24('f00000'),
    null,
    'outside the listed blocks',
  );
  assert.equal(countryCodeForName('Germany'), 'DE');
  assert.equal(countryCodeForName('Republic of Korea'), 'KR');
  assert.equal(countryCodeForName(''), null);
  assert.equal(
    aircraftCountryCode({ icao24: 'f00000', originCountry: 'France' }),
    'FR',
  );
  assert.equal(aircraftCountryCode({}), null);
});

test('a flag is drawn only for a two-letter code', () => {
  assert.equal(flagEmoji('us'), '🇺🇸');
  assert.equal(flagEmoji('USA'), '');
  assert.equal(flagEmoji(null), '');
});
