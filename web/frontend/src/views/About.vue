<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";
import { STANDALONE } from "../apiBase";

const { t } = useI18n();

const appVersion = ref("—");
const nodeVersion = ref("—");
const backendVersion = ref("—");
const versionFailed = ref(false);

const authorUrl = "https://github.com/StarAwA117";
const projectUrl = "https://github.com/StarAwA117/MCWSLoader";
const wikiUrl = "https://github.com/StarAwA117/MCWSLoader/wiki";
const issuesUrl = "https://github.com/StarAwA117/MCWSLoader/issues";
const licenseUrl = "https://www.gnu.org/licenses/gpl-3.0.html";

onMounted(async () => {
	try {
		const info = await api.getProcess();
		appVersion.value = typeof info.version === "string" ? info.version : appVersion.value;
		nodeVersion.value = typeof info.nodeVersion === "string" ? info.nodeVersion : nodeVersion.value;
		backendVersion.value = typeof info.platform === "string" ? info.platform : backendVersion.value;
	} catch {
		versionFailed.value = true;
	}
});
</script>

<template>
	<div class="about-page">
		<section class="about-hero">
			<div class="about-mark" aria-hidden="true">
				<svg viewBox="0 0 48 48" fill="none">
					<path d="M10 34V14l8 9 6-7 6 7 8-9v20" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
					<path d="M10 38h28" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".45"/>
				</svg>
			</div>
			<div class="about-heading">
				<p class="about-kicker">{{ t('about.kicker') }}</p>
				<h1>{{ t('app.name') }}</h1>
				<p class="about-subtitle">{{ t('about.subtitle') }}</p>
			</div>
		</section>

		<p class="about-description">{{ t('about.description') }}</p>

		<div class="about-grid">
			<a class="about-card about-link-card" :href="authorUrl" target="_blank" rel="noreferrer">
				<span class="about-card-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
				</span>
				<span class="about-card-label">{{ t('about.author') }}</span>
				<strong>{{ t('about.authorName') }}</strong>
				<span class="about-card-hint">{{ t('about.authorHint') }} <span aria-hidden="true">↗</span></span>
			</a>

			<a class="about-card about-link-card" :href="projectUrl" target="_blank" rel="noreferrer">
				<span class="about-card-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
				</span>
				<span class="about-card-label">{{ t('about.project') }}</span>
				<strong>StarAwA117/MCWSLoader</strong>
				<span class="about-card-hint">{{ t('about.projectHint') }} <span aria-hidden="true">↗</span></span>
			</a>

			<div class="about-card">
				<span class="about-card-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/></svg>
				</span>
				<span class="about-card-label">{{ t('about.license') }}</span>
				<strong>GPL-3.0</strong>
				<span class="about-card-hint">{{ t('about.licenseHint') }}</span>
			</div>

			<div class="about-card">
				<span class="about-card-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
				</span>
				<span class="about-card-label">{{ t('about.version') }}</span>
				<strong>{{ versionFailed ? t('about.failed') : appVersion }}</strong>
				<span class="about-card-hint">Node.js {{ nodeVersion }}<span v-if="backendVersion !== '—'"> · {{ backendVersion }}</span></span>
			</div>
		</div>

		<section class="about-section">
			<h2>{{ t('about.tech') }}</h2>
			<div class="tech-list">
				<span class="tech-chip"><b>Vue 3</b><span>{{ t('about.techFrontend') }}</span></span>
				<span class="tech-chip"><b>TypeScript</b><span>{{ t('about.techFrontend') }}</span></span>
				<span class="tech-chip"><b>Node.js</b><span>{{ t('about.techBackend') }}</span></span>
				<span class="tech-chip"><b>{{ STANDALONE ? 'Flutter + WebView' : 'Vue + Vite' }}</b><span>{{ t('about.techApp') }}</span></span>
			</div>
		</section>

		<section class="about-section">
			<h2>{{ t('about.links') }}</h2>
			<div class="link-list">
				<a :href="projectUrl" target="_blank" rel="noreferrer">{{ t('about.github') }} <span aria-hidden="true">↗</span></a>
				<a :href="wikiUrl" target="_blank" rel="noreferrer">{{ t('about.wiki') }} <span aria-hidden="true">↗</span></a>
				<a :href="issuesUrl" target="_blank" rel="noreferrer">{{ t('about.issues') }} <span aria-hidden="true">↗</span></a>
				<a :href="licenseUrl" target="_blank" rel="noreferrer">{{ t('about.licenseLink') }} <span aria-hidden="true">↗</span></a>
			</div>
		</section>

		<footer class="about-footer">
			<span>{{ t('about.copyright') }}</span>
			<span>{{ t('about.builtWith') }}</span>
		</footer>
	</div>
</template>

<style scoped>
.about-page {
	max-width: 900px;
	margin: 0 auto;
	padding-bottom: 24px;
}

.about-hero {
	position: relative;
	display: flex;
	align-items: center;
	gap: 22px;
	overflow: hidden;
	padding: 30px;
	border: 1px solid var(--glass-border);
	border-radius: 22px;
	background: var(--glass-bg);
	box-shadow: var(--glass-shadow);
	backdrop-filter: blur(var(--glass-blur)) saturate(1.25);
	-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.25);
}

.about-hero::after {
	content: "";
	position: absolute;
	right: -44px;
	bottom: -70px;
	width: 220px;
	height: 220px;
	border-radius: 50%;
	background: radial-gradient(circle, var(--primary-glow), transparent 70%);
	pointer-events: none;
}

.about-mark {
	position: relative;
	z-index: 1;
	display: grid;
	place-items: center;
	width: 76px;
	height: 76px;
	flex: 0 0 auto;
	border-radius: 24px;
	background: var(--primary-dim);
	color: var(--primary);
	box-shadow: inset 0 0 0 1px var(--primary-shadow);
}

.about-mark svg {
	width: 42px;
	height: 42px;
}

.about-heading {
	position: relative;
	z-index: 1;
	min-width: 0;
}

.about-kicker {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: .14em;
	text-transform: uppercase;
	color: var(--primary);
	margin-bottom: 4px;
}

.about-heading h1 {
	font-size: 28px;
	line-height: 1.15;
	letter-spacing: -.02em;
	color: var(--text);
}

.about-subtitle {
	margin-top: 7px;
	color: var(--text-secondary);
	font-size: 14px;
}

.about-description {
	max-width: 720px;
	margin: 18px 2px 20px;
	color: var(--text-secondary);
	font-size: 14px;
	line-height: 1.8;
}

.about-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12px;
}

.about-card {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	min-height: 132px;
	padding: 18px;
	border: 1px solid var(--border);
	border-radius: 16px;
	background: var(--bg-card);
	box-shadow: var(--shadow);
	text-decoration: none;
	color: var(--text);
	transition: transform var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
}

.about-link-card:hover {
	transform: translateY(-2px);
	border-color: var(--primary);
	box-shadow: var(--shadow-hover);
}

.about-card-icon {
	display: grid;
	place-items: center;
	width: 32px;
	height: 32px;
	margin-bottom: 3px;
	border-radius: 10px;
	background: var(--primary-dim);
	color: var(--primary);
}

.about-card-icon svg {
	width: 18px;
	height: 18px;
}

.about-card-label {
	font-size: 11px;
	font-weight: 600;
	letter-spacing: .04em;
	color: var(--text-muted);
}

.about-card strong {
	font-size: 16px;
	line-height: 1.3;
	word-break: break-word;
}

.about-card-hint {
	font-size: 12px;
	line-height: 1.55;
	color: var(--text-secondary);
}

.about-section {
	margin-top: 24px;
}

.about-section h2 {
	margin-bottom: 10px;
	font-size: 14px;
	font-weight: 700;
	color: var(--text);
}

.tech-list {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.tech-chip {
	display: inline-flex;
	align-items: baseline;
	gap: 7px;
	padding: 8px 12px;
	border: 1px solid var(--border);
	border-radius: 10px;
	background: var(--bg-card);
	font-size: 12px;
	color: var(--text-muted);
}

.tech-chip b {
	color: var(--text);
	font-weight: 600;
}

.link-list {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
}

.link-list a {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 11px 14px;
	border: 1px solid var(--border);
	border-radius: 11px;
	background: var(--bg-card);
	color: var(--text-secondary);
	text-decoration: none;
	font-size: 13px;
	transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.link-list a:hover {
	border-color: var(--primary);
	background: var(--primary-glow);
	color: var(--primary);
}

.about-footer {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 8px 18px;
	margin-top: 26px;
	padding-top: 16px;
	border-top: 1px solid var(--border);
	font-size: 11px;
	color: var(--text-muted);
}

@media (max-width: 640px) {
	.about-hero { padding: 22px; gap: 16px; }
	.about-mark { width: 62px; height: 62px; border-radius: 19px; }
	.about-mark svg { width: 34px; height: 34px; }
	.about-heading h1 { font-size: 24px; }
	.about-grid, .link-list { grid-template-columns: 1fr; }
}
</style>
