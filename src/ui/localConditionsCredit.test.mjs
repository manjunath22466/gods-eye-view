import '../testSupport/registerDom.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import { useEntityCardStore } from './stores/entityCard.js';
import LocalConditions from './views/panels/LocalConditions.vue';

test('the Open-Meteo credit sits on its own unclamped line, outside the weather value', async (t) => {
  const pinia = createPinia();
  const cards = useEntityCardStore(pinia);
  cards.connect({
    spotWeather: async (latitude, longitude) => ({
      coordinates: { latitude, longitude },
      weather: {
        temperatureC: 12,
        weatherCode: 2,
        windKph: 14,
        source: 'open-meteo',
        timeZone: 'UTC',
      },
    }),
  });
  const root = document.createElement('dl');
  const app = createApp({
    render: () => h(LocalConditions, { lat: 35, lon: 139 }),
  });
  app.use(pinia).mount(root);
  t.after(() => {
    app.unmount();
    cards.connect(null);
  });
  await new Promise((resolve) => setImmediate(resolve));
  await nextTick();
  const credit = root.querySelector('a.entity-card__weather-credit');
  assert.ok(
    credit
      ?.closest('dd')
      .classList.contains('entity-card__weather-credit-line'),
  );
  const weather = [...root.querySelectorAll('dd')].find((el) =>
    el.textContent.includes('12 °C'),
  );
  assert.equal(weather.contains(credit), false);
  const css = readFileSync(
    new URL('./styles/entity-card.css', import.meta.url),
    'utf8',
  );
  assert.match(
    css,
    /\.entity-card__weather-credit-line\s*\{[^}]*-webkit-line-clamp:\s*unset/,
  );
});
