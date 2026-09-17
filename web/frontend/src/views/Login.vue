<script setup>
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { loginWithPassword } from "../api";
import { useI18n } from "../composables/useI18n";

const { t } = useI18n();

const router = useRouter();
const route = useRoute();
const password = ref("");
const error = ref("");
const loading = ref(false);
const locked = ref(false);
const waitSec = ref(0);
let waitTimer = null;

async function doLogin(pwd) {
	loading.value = true;
	error.value = "";
	try {
		const data = await loginWithPassword(pwd);
		if (data.ok) {
			sessionStorage.setItem("auth_token", data.token);
			router.replace("/");
		} else if (data.locked) {
			locked.value = true;
			waitSec.value = data.waitSec;
			error.value = t("login.locked", { seconds: data.waitSec });
			if (waitTimer) clearInterval(waitTimer);
			waitTimer = setInterval(() => {
				waitSec.value--;
				if (waitSec.value <= 0) {
					locked.value = false;
					error.value = "";
					clearInterval(waitTimer);
				}
			}, 1000);
		} else {
			error.value = t("login.wrongPassword", { remaining: data.remaining });
		}
	} catch {
		error.value = t("login.connectionFailed");
	}
	loading.value = false;
}

onMounted(() => {
	const token = sessionStorage.getItem("auth_token");
	if (token) {
		router.replace("/");
		return;
	}
	const pwd = route.query.pwd;
	if (pwd) {
		doLogin(pwd);
	}
});

function login() {
	if (!password.value.trim()) {
		error.value = t("login.emptyPassword");
		return;
	}
	doLogin(password.value);
}
</script>

<template>
	<div class="login-page">
		<div class="login-card">
			<div class="login-header">
				<div class="login-bar"></div>
				<h1>{{ t('app.name') }}</h1>
			</div>
			<p class="login-desc">{{ t('login.title') }}</p>
			<div class="form-group">
				<input
					v-model="password"
					type="password"
					:placeholder="t('login.placeholder')"
					:disabled="locked || loading"
					@keyup.enter="login"
					autofocus
				/>
			</div>
			<div v-if="error" class="login-error">{{ error }}</div>
			<button class="btn btn-primary login-btn" @click="login" :disabled="locked || loading">
				{{ loading ? t('login.verifying') : locked ? t('login.waiting', { seconds: waitSec }) : t('login.button') }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.login-page {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100vw;
	height: 100vh;
	position: fixed;
	inset: 0;
	padding: 20px;
	background: var(--bg);
	z-index: 9999;
}

.login-page::before {
	content: "";
	position: fixed;
	top: 5%;
	left: 8%;
	width: 45%;
	height: 45%;
	background: radial-gradient(circle at 50% 50%, rgba(96,165,250,0.55) 0%, rgba(96,165,250,0.25) 35%, rgba(96,165,250,0.08) 55%, transparent 72%);
	filter: blur(40px);
	pointer-events: none;
}

.login-page::after {
	content: "";
	position: fixed;
	bottom: 5%;
	right: 8%;
	width: 45%;
	height: 45%;
	background: radial-gradient(circle at 50% 50%, rgba(96,165,250,0.48) 0%, rgba(96,165,250,0.22) 35%, rgba(96,165,250,0.06) 55%, transparent 72%);
	filter: blur(40px);
	pointer-events: none;
}

.login-card {
	width: 100%;
	max-width: 340px;
	background: var(--bg-card);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 32px 28px;
	box-shadow: var(--shadow);
}

.login-header {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 8px;
}

.login-bar {
	width: 3px;
	height: 20px;
	background: var(--primary);
	border-radius: 2px;
}

.login-header h1 {
	font-size: 20px;
	color: var(--text);
	font-weight: 700;
}

.login-desc {
	font-size: 13px;
	color: var(--text-muted);
	margin-bottom: 20px;
}

.login-error {
	font-size: 13px;
	color: var(--danger);
	margin-bottom: 12px;
}

.login-btn {
	width: 100%;
	padding: 10px;
	font-size: 14px;
}
</style>
