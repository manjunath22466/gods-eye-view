import { ref, watch } from 'vue';
import { requestWithDeadline } from '../sources/requestDeadline.js';
import { weatherAtRequestedPoint, weatherPoint } from './viewWeather.js';

export function useCardWeather(location, store) {
  const weather = ref(null);
  const zone = ref(null);
  const pending = ref(false);
  watch(
    () => weatherPoint(location()),
    (point, _, onCleanup) => {
      weather.value = zone.value = null;
      pending.value = Boolean(point);
      if (!point) return;
      const { lat, lon } = location();
      const controller = new AbortController();
      let nextRead = 0;
      async function read() {
        if (Date.now() < nextRead) return;
        nextRead = Infinity;
        const brief = await requestWithDeadline(
          (signal) => store.readWeather(lat, lon, { exactPoint: true, signal }),
          { signal: controller.signal, timeoutMs: 15_000 },
        ).catch(() => null);
        if (controller.signal.aborted) return;
        pending.value = false;
        weather.value = Number.isFinite(brief?.weather?.temperatureC)
          ? brief.weather
          : null;
        zone.value = weatherAtRequestedPoint(brief, point)
          ? weather.value
          : null;
        nextRead = Date.now() + (weather.value ? 5 * 60_000 : 60_000);
      }
      const stop = watch(() => store.tick, read, { immediate: true });
      onCleanup(() => {
        controller.abort();
        stop();
      });
    },
    { immediate: true },
  );
  return { weather, zone, pending };
}
