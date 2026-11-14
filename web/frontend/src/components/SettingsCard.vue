<script setup lang="ts">
defineOptions({ name: "SettingsCard" });

defineProps({
	title: { type: String, default: "" }
});
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ title }}</h2>
			<slot name="header" />
		</div>
		<slot />
	</div>
</template>
