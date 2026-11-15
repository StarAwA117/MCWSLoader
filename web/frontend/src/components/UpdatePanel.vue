<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { useModal } from "../composables/useModal";
import { useI18n } from "../composables/useI18n";
import { userErrorText } from "../utils/errors";
import { compareVersions } from "../utils/version";
import type { TagInfo } from "../types";

const { ask, choose, notify } = useModal();
const { t } = useI18n();

const currentVersion = ref(t("update.loadingVersion"));
const currentVersionLabel = computed(() => {
	const value = currentVersion.value;
	if (value === t("update.loadingVersion") || value === t("update.unknownVersion")) return value;
	return `v${value}`;
});
const latestVersion = ref<string | null>(null);
const tags = ref<TagInfo[]>([]);
const checking = ref(false);
const actionStatus = ref({ loading: false, message: "" });

async function loadCurrentVersion() {
	try {
		const p = await api.getProcess();
		currentVersion.value = (p.version as string) || t("update.unknownVersion");
	} catch {
		currentVersion.value = t("update.unknownVersion");
	}
}

async function checkUpdate() {
	checking.value = true;
	actionStatus.value = { loading: false, message: "" };
	try {
		const res = await api.checkUpdate();
		latestVersion.value = (res.latest as string | null) ?? null;
		if (res.error) {
			actionStatus.value = { loading: false, message: t("update.checkFailed") + ": " + res.error };
		} else if (res.hasUpdate) {
			actionStatus.value = { loading: false, message: t("update.foundNew", { latest: res.latest, current: res.current }) };
		} else if (res.latest && compareVersions(String(res.latest), String(res.current ?? "")) < 0) {
			actionStatus.value = { loading: false, message: t("update.currentNewer", { latest: res.latest }) };
		} else if (res.latest) {
			actionStatus.value = { loading: false, message: t("update.latest") };
		} else {
			actionStatus.value = { loading: false, message: t("update.noInfo") };
		}
	} catch (e) {
		actionStatus.value = { loading: false, message: t("update.checkFailed") + ": " + userErrorText(e) };
	}
	checking.value = false;
}

async function loadTags(): Promise<void> {
	try {
		const res = await api.getTags();
		tags.value = Array.isArray(res.tags) ? (res.tags as TagInfo[]) : [];
	} catch {
		tags.value = [];
	}
}

function getActionLabel(tag: string): string {
	const selected = tag.replace(/^v/, "");
	const current = currentVersion.value.replace(/^v/, "");
	const diff = compareVersions(selected, current);
	if (diff > 0) return t("update.update");
	if (diff < 0) return t("update.rollback");
	return t("update.keep");
}

async function openVersionPicker(): Promise<void> {
	await loadTags();
	if (!tags.value.length) {
		await notify(t("update.noInfo"), t("update.title"));
		return;
	}
	const picked = await choose(
		tags.value.map((tag) => ({ value: tag.name, label: tag.name })),
		t("update.selectVersion"),
		t("update.availableReleases")
	);
	if (!picked) return;

	const tag = String(picked);
	const label = getActionLabel(tag);
	if (label === t("update.keep")) return;

	const ok = await ask(
		t("update.confirmAction", { action: label === t("update.update") ? t("update.update") : t("update.rollback"), tag }),
		t("update.title")
	);
	if (!ok) return;

	actionStatus.value = { loading: true, message: `${label}，${t("update.pleaseWait")}` };
	try {
		// The version picker targets the exact tag the user selected, not merely the latest release.
		const res = await api.rollback(tag);
		if (res.ok) {
			actionStatus.value = { loading: false, message: res.message || `${label}${t("update.done")}` };
		} else {
			actionStatus.value = { loading: false, message: res.message || `${label}${t("update.failed")}` };
		}
	} catch (e) {
		actionStatus.value = { loading: false, message: `${label}${t("update.failed")}: ` + userErrorText(e) };
	}
}

onMounted(() => {
	// Automatic checks happen only at script startup (update.autoCheck).
	// Opening the System tab must not hit GitHub until the user clicks Check.
	loadCurrentVersion();
});
</script>

<template>
	<div class="update-panel">
		<div class="stats-grid">
			<div class="stat-card">
				<div class="label">{{ t('update.currentVersion') }}</div>
				<div class="value">{{ currentVersionLabel }}</div>
			</div>
			<div class="stat-card">
				<div class="label">{{ t('update.latestVersion') }}</div>
				<div class="value blue">{{ latestVersion ? "v" + latestVersion : t('update.notChecked') }}</div>
			</div>
		</div>
		<div style="margin-top: 16px; display: flex; align-items: center; gap: 12px;">
			<button class="btn btn-primary" @click="checkUpdate" :disabled="checking || actionStatus.loading">
				{{ checking ? t('update.checking') : t('update.checkUpdate') }}
			</button>
			<button v-if="latestVersion" class="btn btn-secondary" @click="openVersionPicker" :disabled="actionStatus.loading">
				{{ t('update.tags') }}
			</button>
		</div>
		<p v-if="actionStatus.message" style="margin-top: 12px; font-size: 13px;">{{ actionStatus.message }}</p>
	</div>
</template>
