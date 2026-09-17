<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import { useModal } from "../composables/useModal";
import { useI18n } from "../composables/useI18n";

const { confirm, alert } = useModal();
const { t } = useI18n();

const currentVersion = ref("加载中...");
const latestVersion = ref(null);
const tags = ref([]);
const releaseInfo = ref(null);
const checking = ref(false);
const actionStatus = ref({ loading: false, message: "" });
const selectedTag = ref(null);
const showModal = ref(false);
const modalStatus = ref({ loading: false, message: "" });

function lockScroll() { document.body.classList.add("modal-open"); }
function unlockScroll() { document.body.classList.remove("modal-open"); }
function openModal() {
	selectedTag.value = latestVersion.value ? `v${latestVersion.value}` : (tags.value[0]?.name || null);
	modalStatus.value = { loading: false, message: "" };
	showModal.value = true;
	lockScroll();
}
function closeModal() {
	showModal.value = false;
	unlockScroll();
}

async function loadCurrentVersion() {
	try {
		const p = await api.getProcess();
		currentVersion.value = p.version || "未知";
	} catch {
		currentVersion.value = "未知";
	}
}

async function checkUpdate() {
	checking.value = true;
	actionStatus.value = { loading: false, message: "" };
	try {
		const res = await api.checkUpdate();
		latestVersion.value = res.latest;
		releaseInfo.value = res;
		if (res.error) {
			actionStatus.value = { loading: false, message: t("update.checkFailed") + ": " + res.error };
		} else if (res.hasUpdate) {
			actionStatus.value = { loading: false, message: t("update.foundNew", { latest: res.latest, current: res.current }) };
		} else if (res.latest) {
			actionStatus.value = { loading: false, message: t("update.latest") };
		} else {
			actionStatus.value = { loading: false, message: t("update.noInfo") };
		}
	} catch (e) {
		actionStatus.value = { loading: false, message: t("update.checkFailed") + ": " + e.message };
	}
	checking.value = false;
}

async function loadTags() {
	try {
		const res = await api.getTags();
		tags.value = res.tags || [];
	} catch {
		tags.value = [];
	}
}

function getActionLabel() {
	if (!selectedTag.value) return t("update.update");
	const selVer = selectedTag.value.replace(/^v/, "");
	const curVer = currentVersion.value.replace(/^v/, "");
	if (selVer === curVer) return t("update.keep");
	const selParts = selVer.split(".").map(Number);
	const curParts = curVer.split(".").map(Number);
	for (let i = 0; i < Math.max(selParts.length, curParts.length); i++) {
		const s = selParts[i] || 0;
		const c = curParts[i] || 0;
		if (s > c) return t("update.update");
		if (s < c) return t("update.rollback");
	}
	return t("update.keep");
}

async function confirmAction() {
	if (!selectedTag.value) return;
	const tag = selectedTag.value.startsWith("v") ? selectedTag.value : `v${selectedTag.value}`;
	const label = getActionLabel();
	if (label === t("update.keep")) { closeModal(); return; }
	const ok = await confirm(t("update.confirmAction", { action: label === t("update.update") ? t("update.update") : t("update.rollback"), tag }));
	if (!ok) return;
	modalStatus.value = { loading: true, message: `${label}，${t('update.pleaseWait')}` };
	try {
		const res = label === t("update.update") ? await api.doUpdate() : await api.rollback(tag);
		if (res.ok) {
			modalStatus.value = { loading: false, message: res.message || `${label}${t('update.done')}` };
		} else {
			modalStatus.value = { loading: false, message: res.message || `${label}${t('update.failed')}` };
		}
	} catch (e) {
		modalStatus.value = { loading: false, message: `${label}${t('update.failed')}: ` + e.message };
	}
}

onMounted(() => {
	loadCurrentVersion();
	checkUpdate();
	loadTags();
});

onBeforeUnmount(unlockScroll);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ t('update.title') }}</h2>
		</div>
		<div class="stats-grid">
			<div class="stat-card">
				<div class="label">{{ t('update.currentVersion') }}</div>
				<div class="value">v{{ currentVersion }}</div>
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
			<button v-if="latestVersion" class="btn btn-secondary" @click="openModal" :disabled="actionStatus.loading">
				{{ t('update.tags') }}
			</button>
		</div>
		<p v-if="actionStatus.message" style="margin-top: 12px; font-size: 13px;">{{ actionStatus.message }}</p>
	</div>

	<div v-if="showModal" class="modal-overlay" @click.self="closeModal">
		<div class="modal">
			<div class="modal-header">
				<h3>{{ t('update.selectVersion') }}</h3>
				<button class="modal-close" @click="closeModal">&times;</button>
			</div>
			<div class="modal-body">
				<label style="font-size: 13px; color: var(--text-muted); display: block; margin-bottom: 6px;">{{ t('update.availableReleases') }}</label>
				<select v-model="selectedTag" class="modal-select" :disabled="modalStatus.loading">
					<option v-for="tag in tags" :key="tag.name" :value="tag.name">{{ tag.name }}</option>
				</select>
				<p v-if="modalStatus.message" style="margin-top: 12px; font-size: 13px;">{{ modalStatus.message }}</p>
			</div>
			<div class="modal-footer">
				<button class="btn btn-ghost" @click="closeModal" :disabled="modalStatus.loading">{{ t('modal.cancel') }}</button>
				<button class="btn btn-primary" @click="confirmAction" :disabled="modalStatus.loading">
					{{ modalStatus.loading ? t('update.processing') : getActionLabel() }}
				</button>
			</div>
		</div>
	</div>
</template>
