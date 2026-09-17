<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api";
import { useModal } from "../composables/useModal";
import { useI18n } from "../composables/useI18n";

const { alert, confirm } = useModal();
const { t } = useI18n();

const permissions = ref({ owner: "", op: [], user: [], blocker: [] });
const newPlayer = ref({ op: "", user: "", blocker: "" });
const groups = ["owner", "op", "user", "blocker"];
const groupKeys = { owner: "owner", op: "op", user: "user", blocker: "blocker" };
const groupColors = { owner: "tag-owner", op: "tag-op", user: "tag-user", blocker: "tag-blocker" };

async function refresh() {
	const data = await api.getPermissions();
	permissions.value = data;
	newPlayer.value.owner = data.owner || "";
}

async function addPlayer(group) {
	const name = newPlayer.value[group]?.trim();
	if (!name) return;
	const res = await api.addPermission(group, name);
	if (res.ok) {
		newPlayer.value[group] = "";
		await refresh();
	} else {
		await alert(res.message || t("permissions.addFailed"));
	}
}

async function removePlayer(group, player) {
	const ok = await confirm(t("permissions.confirmRemove", { player, group: t("permissions." + group) }));
	if (!ok) return;
	const res = await api.removePermission(group, player);
	if (res.ok) await refresh();
	else await alert(res.message || t("permissions.removeFailed"));
}

onMounted(refresh);
</script>

<template>
	<div v-for="group in groups" :key="group" class="card">
		<div class="card-header">
			<h2>{{ t('permissions.' + group) }}</h2>
			<span :class="'badge ' + (groupColors[group])">
				{{ group === 'owner' ? (permissions[group] || t('permissions.notSet')) : (permissions[group]?.length || 0) + ' ' + t('permissions.people') }}
			</span>
		</div>

		<div v-if="group === 'owner'" style="display: flex; gap: 8px;">
			<input
				v-model="newPlayer[group]"
				type="text"
				:placeholder="t('permissions.setOwnerPlaceholder')"
				@keydown.enter="addPlayer(group)"
				style="flex: 1; min-width: 0;"
			/>
			<button class="btn btn-primary btn-sm" @click="addPlayer(group)">{{ t('permissions.set') }}</button>
		</div>

		<template v-else>
			<div style="display: flex; gap: 8px; margin-bottom: 12px;">
				<input
					v-model="newPlayer[group]"
					type="text"
					:placeholder="t('permissions.addPlaceholder', { group: t('permissions.' + group) })"
					@keydown.enter="addPlayer(group)"
					style="flex: 1; min-width: 0;"
				/>
				<button class="btn btn-primary btn-sm" @click="addPlayer(group)">{{ t('permissions.add') }}</button>
			</div>

			<div v-if="!permissions[group]?.length" style="color: var(--text-muted); font-size: 13px; padding: 8px 0;">
				{{ t('permissions.none') }}
			</div>
			<div v-else style="display: flex; flex-wrap: wrap; gap: 6px;">
				<div
					v-for="player in permissions[group]"
					:key="player"
					style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: var(--bg-input); border-radius: 6px; font-size: 13px;"
				>
					<span>{{ player }}</span>
					<button
						style="background: none; border: none; color: var(--primary); cursor: pointer; font-size: 14px; padding: 0 2px;"
						@click="removePlayer(group, player)"
					>×</button>
				</div>
			</div>
		</template>
	</div>
</template>
