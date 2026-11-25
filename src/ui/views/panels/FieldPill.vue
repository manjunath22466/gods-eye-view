<script setup>
// A reading in its legend band: the band's colour as a dot beside its words,
// as Conditions here shows it. Without a band, the words alone.
defineProps({
  text: { type: String, default: '' },
  level: { type: String, default: '' },
  color: { type: String, default: '' },
  tag: { type: String, default: 'strong' },
});
// A layer's own legend colour, as a plain hex colour.
const HEX = /^#[0-9a-f]{3,8}$/i;
</script>

<template>
  <!-- Whitespace is preserved in templates: the pill's children touch so no
       space renders before the swatch or the words. -->
  <component :is="tag" class="field-pill" :data-level="(level && HEX.test(color) && level) || undefined" :style="HEX.test(color) ? { '--field-band': color } : undefined"><i v-if="HEX.test(color)" class="spot-conditions__field-swatch" aria-hidden="true"></i><span class="field-pill__text">{{ text }}</span></component>
</template>
